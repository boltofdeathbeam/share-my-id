var 
  // load config from file
  bodyParser = require('body-parser'),
  config = require('./helpers/config'),
  createServer = require("auto-sni"),
  express = require('express'),
  fs = require('fs'),
  httpLogging = require('./helpers/http-logging'),
  querystring = require("querystring"),
  request = require('request'),
  session = require('express-session'),
  SmidManger = require('./local_modules/smid-manager.js').SmidManger;

/*
   for development goto mongo console
    use smid;
    db.createUser({
      user: "smid_user",
      pwd: "devpassword",
          roles: ["readWrite"]
    });
*/

var smidManger = new SmidManger('smid_user:devpassword@127.0.0.1:27017/smid',['smids']);

// quick and dirty test
smidManger.createSmid('0000-0000-0000-0000','test name', function(err, doc) {
   console.log(doc);
   smidManger.updateForm(doc.private_key, {title: 'test update title', description: 'test update description'}, function(err,doc) {
      console.log(doc);
   });
   smidManger.addOrcidName(doc.public_key, {orcid: '0000-0000-0000-0001', name: 'test1'}, function(err,doc) {
      console.log(doc);
   });
   smidManger.addOrcidName(doc.public_key, {orcid: '0000-0000-0000-0002', name: 'test2'}, function(err,doc) {
      console.log(doc);
   });
   smidManger.addOrcidName(doc.public_key, {orcid: '0000-0000-0000-0001', name: 'test1'}, function(err,doc) {
      console.log(doc);
   });
});

// Init express
var app = express();
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({  
    secret: "notagoodsecretnoreallydontusethisone",  
    resave: false,
    saveUninitialized: true,
    cookie: { 
      httpOnly: true, 
      secure: (config.FORCE_SSL === 'true')
    },
}));

secureServer = createServer({
  email: config.LETSENCRYPT_ISSUES_EMAIL, // Emailed when certificates expire.
  agreeTos: true, // Required for letsencrypt.
  debug: (config.AUTO_SNI_DEBUG === 'true'), // Add console messages and uses staging LetsEncrypt server. (Disable in production)
  domains: config.DOMAINS.split(','), // List of accepted domain names. (You can use nested arrays to register bundles with LE).
  forceSSL: (config.FORCE_SSL === 'true'), // Make this false to disable auto http->https redirects (default true).
  redirectCode: 301, // If forceSSL is true, decide if redirect should be 301 (permanent) or 302 (temporary). Defaults to 302
  ports: {
    http: parseInt(config.PORT_HTTP), // Optionally override the default http port.
    https: parseInt(config.PORT_HTTPS) // Optionally override the default https port.
  }
}, app);
secureServer.listen(config.PORT_HTTPS, config.SERVER_IP, function () { // Start express
  console.log('server started on ' + config.PORT_HTTPS);
});

// Custom console for orcid logging
var orcidOutput = fs.createWriteStream('./orcidout.log');
var orcidErrorOutput = fs.createWriteStream('./orciderr.log');
var orcidLogger = new console.Console(orcidOutput, orcidErrorOutput);
var CREATE_SMID_URI = '/create-smid-redirect';
var ADD_ID_REDIRECT = '/add-id-redirect';

// generates a link to orcid for authorization
function getAuthUrl(redirect_uri, state) {
  return config.ORCID_URL + '/oauth/authorize' + '?'
   + querystring.stringify({
      'redirect_uri': redirect_uri,
      'scope': '/authenticate',
      'response_type':'code',
      'client_id': config.CLIENT_ID,
      'show_login': 'true',
      'state': state //state maps to current google sheet
    });
}

function exchangeCode(req,callback) {
      // config for exchanging code for token 
    var reqConfig = {
      url: config.ORCID_URL + '/oauth/token',
      method: 'post',
      body: querystring.stringify({
        'code': req.query.code,
        'client_id': config.CLIENT_ID,
        'client_secret': config.CLIENT_SECRET,
        'grant_type': 'authorization_code',
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8'
      }
    }
    //making request exchanging code for token
    request(reqConfig, callback);
}


app.get('/:publicKey/details', function(req,res) {
  smidManger.getDetails(req.params.publicKey, function(err, doc) {
    if (err) res.send(err)
    else {
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(doc, null, 2));
    }
  });
});

app.put('/:publicKey/details/:publicKey/edit/:privateKey/details/form', function(req,res) {
  var form = req.body;
  smidManger.updateForm(req.params.publicKey, form, function(err, doc) {
    if (err) res.send(err)
    else {
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(doc, null, 2));
    }
  });
});


app.get('/orcid-id.json', function(req, res) {
  res.json({'orcid_id': req.session.orcid_id});
});

app.get(CREATE_SMID_URI, function(req, res) { // Redeem code URL
  var state = req.query.state; 
  console.log("spreed sheet from /redirect-uri url " + state);
  if (req.query.error == 'access_denied') {
    // User denied access
    //res.render('pages/access_denied', {'authorization_uri': getAuthUrl(config.HOST + CREATE_SMID_URI),'orcid_url': config.ORCID_URL });
    res.redirect('/?error=access_denied&error_description=User%20denied%20access');      
  } else {
    // exchange code
    // function to render page after making request
    var exchangingCallback = function(error, response, body) {
      if (error == null) { // No errors! we have a token :-)
        var token = JSON.parse(body);
        console.log(token);
        var date = new Date();
        //Log ORCID info to file
        orcidLogger.log(date, token.name, token.orcid, req.query.state);
        //state maps to current google sheet
        console.log("creating smid for" + token.orcid);
        smidManger.createSmid(token.orcid,token.name, function(err, doc) {
            res.redirect("/" + doc.public_key + "/edit/"+doc.private_key);   
        });
        
      } else // handle error
        res.render('pages/error', { 'error': error, 'orcid_url': config.ORCID_URL });
    };
    exchangeCode(req,exchangingCallback);
  }
});


app.get(ADD_ID_REDIRECT, function(req, res) { // Redeem code URL
  var state = req.query.state; 
  console.log("spreed sheet from /redirect-uri url " + state);
  if (req.query.error == 'access_denied') {
    // User denied access
    res.render('pages/access_denied', {'state': req.query.state, 'authorization_uri': getAuthUrl(config.HOST + ADD_ID_REDIRECT, req.query.state),'orcid_url': config.ORCID_URL });      
  } else {
    // exchange code
    // function to render page after making request
    var exchangingCallback = function(error, response, body) {
      if (error == null) { // No errors! we have a token :-)
        var token = JSON.parse(body);
        console.log(token);
        var date = new Date();
        //Log ORCID info to file
        orcidLogger.log(date, token.name, token.orcid, req.query.state);
        req.session.orcid_id = token.orcid;
        //state maps to current google sheet
        console.log("Got user id: " + token.orcid);
        smidManger.addOrcidName(req.query.state, {orcid: token.orcid, name: token.name}, function(err,doc) {
          console.log(doc);
        });
        res.render('pages/success', { 'body': JSON.parse(body), 'state': req.query.state, 'orcid_url': config.ORCID_URL});
      } else // handle error
        res.render('pages/error', { 'error': error, 'state': req.query.state, 'orcid_url': config.ORCID_URL });
    };
    exchangeCode(req,exchangingCallback);
  }
});

app.get(['/:publicKey/edit/:privateKey','/:publicKey','/'], function(req, res) { // Index page 
  // reset any session on reload of '/'
  req.session.regenerate(function(err) {
      // nothing to do
  });
  res.render('pages/index', {
    'create_smid_authorization_uri': getAuthUrl(config.HOST + CREATE_SMID_URI),
    'add_id_authorization_uri': getAuthUrl(config.HOST + ADD_ID_REDIRECT, req.params.publicKey),
    'edit_smid_link': config.HOST + '/' + req.params.publicKey + '/edit/' + req.params.privateKey,
    'share_smid_link': config.HOST + '/' + req.params.publicKey,
    'put_form_link': config.HOST + '/' + req.params.publicKey + '/edit/' + req.params.privateKey + '/details/form',
    'details_json_link': config.HOST + '/' + req.params.publicKey + '/details/',
    'orcid_url': config.ORCID_URL
  });
});
