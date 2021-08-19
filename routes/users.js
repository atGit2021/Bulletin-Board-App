var express = require('express');
var router = express.Router();
var models = require('../models');
var authService = require('../services/auth');

/* GET users listing. */
router.get('/', function (req, res, next) {
  res.send('respond with a resource');
});

//----------- routes for signup -------------------
//gets the signup view
router.get('/signup', function (req, res, next) {
  res.render('signup');
});

// Create new user if one doesn't exist
router.post('/signup', function (req, res, next) {

  models.users
    .findOrCreate({
      where: {
        Username: req.body.username
      },
      defaults: {
        FirstName: req.body.firstName,
        LastName: req.body.lastName,
        Email: req.body.email,
        Password: authService.hashPassword(req.body.password)
      }
    })
    .spread(function (result, created) {
      if (created) {
        res.redirect('login');
      } else {
        res.send('This user already exists');
      }
    });
});


//------- routes for login ----------
router.get('/login', function (req, res, next) {
  res.render('login');
});

// Login user and return JWT as cookie
router.post('/login', function (req, res, next) {

  models.users.findOne({
    where: {
      Username: req.body.username,
    }
  }).then(user => {
    if (!user) {
      console.log('User not found')
      return res.status(401).json({ message: "Login Failed" });
    }
    //check if the user has been deleted by the admin
    if (user.Deleted) {
      return res.send("Login Failed: See Your Administrator For Details");
    }

    if (user) {
      let passwordMatch = authService.comparePasswords(req.body.password, user.Password);
      if (passwordMatch) {
        let token = authService.signUser(user); // <--- Uses the authService to create jwt token
        res.cookie('jwt', token); // <--- Adds token to response as a cookie
        res.redirect('profile');
      } else {
        console.log('Wrong password');
        res.redirect('login');
      }
    }
  })
});

//----Route to logout---------
router.get('/logout', function (req, res, next) {
  res.cookie('jwt', "", { expires: new Date(0) });
  res.redirect('login');
});


//----Route for getting the logged in user's profile
router.get('/profile', function (req, res, next) {
  let token = req.cookies.jwt;
  if (token) {

    authService.verifyUser(token)
      .then(user => {
        if (user) {

          models.users.findOne({
            include: [{
              model: models.posts,
              where: { Deleted: false }
             }],
            where: {
              UserId: user.UserId,
              Deleted: false
            }
          })
            .then(results => {
              res.render('profile', {
                FirstName: user.FirstName,
                LastName: user.LastName,
                Username: user.Username,
                postsFound: results.posts
              });
            });

        } else {
          res.status(401);
          console.log('Must be logged in');
          res.redirect('login');
        }
      });
  } else {
    console.log('Invalid token. Must be logged in');
    res.redirect('login');
  }

});


//----Admin Page - list all users not deleted--------------
router.get('/admin', function (req, res, next) {
  let token = req.cookies.jwt;

  if (token) {

    authService.verifyUser(token)
      .then(user => {
        if (user.Admin) {
          models.users
            .findAll({
              attributes: ['UserId', 'FirstName', 'LastName'],
              where: { Deleted: false }
            })
            .then(results => {
              res.render('admin', { usersFound: results });
            })
            .catch(err => {
              res.status(400);
              res.send(err.message);
            });
        } else {
          res.status(401);
          res.send('Not authorized to access this page.');
        }
      });

  } else {
    res.status(401);
    res.send('Must be logged in');
  }
});

//--Admin view of selected user profile and associated posts---------
router.get('/admin/viewUser/:id', function (req, res, next) {
  let token = req.cookies.jwt;

  if (token) {
    authService.verifyUser(token)
      .then(user => {
        if (user.Admin) {
          console.log("admin loading posts for params id: " + req.params.id);

          models.users.findByPk(parseInt(req.params.id)).then(
            userFound => {
              if (userFound) {

                //need to pull in all the user's posts
                models.posts
                  .findAll({
                    attributes: ['PostId', 'PostTitle', 'PostBody', 'UserId'],
                    where: {
                      UserId: userFound.UserId,
                      Deleted: false
                    }
                  })
                  .then(postsReturned => {
                    res.render('adminView', {
                      UserId: userFound.UserId,
                      FirstName: userFound.FirstName,
                      LastName: userFound.LastName,
                      Username: userFound.Username,
                      postsFound: postsReturned
                    });
                  });

              } else {
                res.send('User not found');
              }
            })

        } else {
          res.status(401);
          res.send('Not authorized to access this page.');
        }
      });
  } else {
    res.status(401);
    res.send('Must be logged in');
  }
});


//----Admin delete selected user and associated posts--------------
router.post('/delete/:id', function (req, res, next) {
  let token = req.cookies.jwt;

  if (token) {
    authService.verifyUser(token)
      .then(user => {
        if (user.Admin) {

          let uId = parseInt(req.params.id);
          models.users.findByPk(uId).then(userFound => {
            if (userFound) {

              //update all the post entries for this user to deleted status
              models.posts
                .update({ Deleted: true }, { where: { UserId: uId } })
                .then(result => console.log("all posts deleted for userId:" + uId))
                .catch(err => {
                  res.send("There was a problem updating the deleted field for all posts. " + err.message);
                });

              //update the DB to deleted status for this user
              models.users
                .update({ Deleted: true }, { where: { UserId: uId } })
                .then(result => res.redirect('/users/admin'))
                .catch(err => {
                  res.send("There was a problem updating the deleted field for userId: " + uId);
                });


            } else {
              res.send('User not found');
            }
          });

        } else {
          res.status(401);
          res.send('Not authorized to access this page.');
        }
      });
  } else {
    res.status(401);
    res.send('Must be logged in');
  }

});


//-----route for Admin to delete a post by param id ------------
router.post('/admin/deletePost/:id', function (req, res, next) {
  let token = req.cookies.jwt;

  if (token) {
    authService.verifyUser(token)
      .then(user => {
        if (user) {

          let pId = parseInt(req.params.id);
          let authorId = parseInt(req.body.authorId)

          models.posts.findByPk(pId).then(postFound => {
            if (postFound) {
              models.posts
                .update({ Deleted: true }, { where: { PostId: pId } })
                .then(result => {
                  res.redirect('/users/admin/viewUser/' + authorId);
                })
                .catch(err => {
                  res.send("There was a problem deleting your post. " + err.message);
                });
            } else {
              res.send('Post not found');
            }
          });

        } else {
          res.status(401);
          console.log('Must be logged in');
          res.redirect('login');
        }
      });
  } else {
    res.status(401);
    res.send('Must be logged in');
  }
});



//------- routes for newPosts ----------
router.get('/newPost', function (req, res, next) {
  let token = req.cookies.jwt;
  if (token) {

    authService.verifyUser(token)
      .then(user => {
        if (user) {
          res.render('newPost');
        } else {
          res.status(401);
          console.log('Must be logged in');
          res.redirect('login');
        }
      });

  } else {
    console.log('Invalid token. Must be logged in');
    res.redirect('login');
  }
});

//----Route for creating a new post------
router.post('/newPost', function (req, res, next) {
  let token = req.cookies.jwt;
  if (token) {

    authService.verifyUser(token)
      .then(user => {
        if (user) {

          models.posts
            .create({
              PostTitle: req.body.postTitle,
              PostBody: req.body.postBody,
              UserId: user.UserId
            })
            .then(result => {
              res.redirect('profile');
            })
            .catch(err => {
              res.send("An error occurred with your post: " + err.message);
            });

        } else {
          res.status(401);
          console.log('Must be logged in');
          res.redirect('login');
        }
      });
  } else {
    console.log('Invalid token. Must be logged in');
    res.redirect('login');
  }
});

//-----route to delete a post by param id ------------
router.post('/posts/delete/:id', function (req, res, next) {
  let token = req.cookies.jwt;

  if (token) {
    authService.verifyUser(token)
      .then(user => {
        if (user) {

          let pId = parseInt(req.params.id);

          models.posts.findByPk(pId).then(postFound => {
            if (postFound) {
              models.posts
                .update({ Deleted: true }, { where: { PostId: pId } })
                .then(result => {
                  res.redirect('/users/profile');
                })
                .catch(err => {
                  res.send("There was a problem deleting your post. " + err.message);
                });
            } else {
              res.send('Post not found');
            }
          });

        } else {
          res.status(401);
          console.log('Must be logged in');
          res.redirect('login');
        }
      });
  } else {
    res.status(401);
    res.send('Must be logged in');
  }
});


//-----route to get a post by param id to render edit view------------
router.get('/editPost/:id', function (req, res, next) {
  let token = req.cookies.jwt;

  if (token) {
    authService.verifyUser(token)
      .then(user => {
        if (user) {
          let pId = parseInt(req.params.id);

          models.posts.findByPk(pId).then(postFound => {
            if (postFound) {

              res.render('editPost', {
                PostId: postFound.PostId,
                PostTitle: postFound.PostTitle,
                PostBody: postFound.PostBody
              });

            } else {
              res.send('Post not found');
            }
          });

        } else {
          res.status(401);
          console.log('Must be logged in');
          res.redirect('login');
        }
      });
  } else {
    res.status(401);
    res.send('Must be logged in');
  }
});


//-----route to process an update to a post by param id ------------
router.post('/editPost/:id', function (req, res, next) {
  let token = req.cookies.jwt;

  if (token) {
    authService.verifyUser(token)
      .then(user => {
        if (user) {

          let pId = parseInt(req.params.id);
         
          models.posts.findByPk(pId).then(postFound => {
            if (postFound) {

              models.posts
                .update({
                  PostTitle: req.body.postTitle,
                  PostBody: req.body.postBody
                }, {
                  where: { PostId: pId }
                })
                .then(result => {
                  res.redirect('/users/profile');
                })
                .catch(err => {
                  res.send("There was a problem updating the post: " + err.message);
                });

            } else {
              res.send('Post not found');
            }
          });

        } else {
          res.status(401);
          console.log('Must be logged in');
          res.redirect('login');
        }
      });
  } else {
    res.status(401);
    res.send('Must be logged in');
  }
});




module.exports = router;
