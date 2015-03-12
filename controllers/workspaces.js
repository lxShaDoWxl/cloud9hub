var fs = require('fs'),
    fse = require('fs-extra'),
  path = require('path'),
  rimraf = require('rimraf'),
  _ = require('lodash'),
  spawn = require('child_process').spawn;

var respondInvalidWorkspace = function(res) {
  res.status(400);
  res.json({msg: "Invalid workspace name"});
};

var createWorkspace = function(params, req, res) {
  var potentiallyBadPathName = params.name.split(path.sep);
  var workspaceName = potentiallyBadPathName[potentiallyBadPathName.length-1];

  if(workspaceName === '..') {
    respondInvalidWorkspace(res);
    return;
  }

  var workspacePath = __dirname + '/../workspaces/' + req.user + "/" + workspaceName,
      codeBasePath = __dirname + '/../../code_base/';  

  fs.mkdir(workspacePath, '0700', function(err) {
    if(err) {
      respondInvalidWorkspace(res);
      return;
    }    

    fse.copy(codeBasePath, workspacePath, function(err) {
      console.log('cloning workspace');
      if (err){
        console.log(err);
        respondInvalidWorkspace(res);
        return;
      }
      console.log("workspace cloned");
    }); 
    res.json({msg: "Workspace " + workspaceName + " was created."});
  });
};

var createWorkspaceKillTimeout = function(req, workspaceProcess, workspaceName) {
  var timeout = setTimeout(function() {
    process.kill(-workspaceProcess.pid, 'SIGTERM');
    req.app.get('runningWorkspaces')[req.user + '/' + workspaceName] = undefined;
    console.info("Killed workspace " + workspaceName);
   }, 900000); //Workspaces have a lifetime of 15 minutes

   return timeout;
};

/*
 * POST/GET create a new workspace
 */
exports.create = function(req, res) {
  if(req.body.name) {
    createWorkspace(req.body, req, res);
  } else {
    respondInvalidWorkspace(res);
  }
}

/*
 * GET workspaces listing.
 */
exports.list = function(req, res){
  fs.readdir(__dirname + '/../workspaces/' + req.user, function(err, files) {
    if(err) {
      res.status(500);
      res.json({error: err});
    } else {
      var workspaces = [];
      console.log(files);
      for(var i=0; i< files.length; i++) {
          // Skip hidden files
          if(files[i][0] === '.') continue;
          workspaces.push({name: files[i]});
      }
      res.json({workspaces: workspaces});
    }
  });
};

/**
 * DELETE destroys a workspace
 */
exports.destroy = function(req, res) {
  var potentiallyBadPathName = req.params.name.split(path.sep);
  var workspaceName = potentiallyBadPathName[potentiallyBadPathName.length-1];

  if(workspaceName === '..') {
    respondInvalidWorkspace(res);
    return;
  }

  rimraf(__dirname + "/../workspaces/" + req.user + "/" + workspaceName, function(err) {
    if(err) {
      res.status("500");
      res.json({msg: "Something went wrong :("});
      return;
    }
    res.json({msg: "Successfully deleted " + workspaceName});
  })
};

/*
 * GET run a workspace
 */
 exports.run = function(req, res) {
  var potentiallyBadPathName = req.params.name.split(path.sep);
  var workspaceName = potentiallyBadPathName[potentiallyBadPathName.length-1];
  
    var isPortTaken = function(port, fn) {
      console.log('checking if port', port, 'is taken');
      var net = require('net');
      var tester = net.createServer()
      .once('error', function (err) {
        if (err.code != 'EADDRINUSE') return fn(err);
        console.log('port', port, 'seems to be taken');
        fn(null, true);
      })
      .once('listening', function() {
        tester.once('close', function() { 
            console.log('port', port, 'seems to be available');
            fn(null, false); 
        })
        .close();
      })
      .listen(port);
    };
    
    var getNextAvailablePort = function(callback){
        var nextFreeWorkspacePort = req.app.get('nextFreeWorkspacePort');
        
        if(nextFreeWorkspacePort > 10000) {
            nextFreeWorkspacePort = 5000;
        }
        
        nextFreeWorkspacePort = nextFreeWorkspacePort + 1;
        console.log('setting nextFreeWorkspacePort to', nextFreeWorkspacePort);
        req.app.set('nextFreeWorkspacePort', nextFreeWorkspacePort);
        
        isPortTaken(nextFreeWorkspacePort, function(err, taken){
            if(taken){
                getNextAvailablePort(callback);
            } else {
                req.app.set('nextFreeWorkspacePort', nextFreeWorkspacePort);
                callback(nextFreeWorkspacePort);
            }
        });
    };

    if(workspaceName === '..') {
      respondInvalidWorkspace(res);
      return;
    }

   if(typeof req.app.get('runningWorkspaces')[req.user + '/' + workspaceName] === 'undefined'){
       getNextAvailablePort(function(nextFreePort){
           var c9SdkStartPath =  __dirname + '/../../c9sdk/scripts/start.sh';
            console.log("Starting " + c9SdkStartPath +' for workspace ' + workspaceName + " on port " + nextFreePort);
       
            var workspace = spawn(c9SdkStartPath, ['-w', __dirname + '/../workspaces/' + req.user + '/' + workspaceName, '-l', '0.0.0.0', '-p', nextFreePort], {detached: true});
            workspace.stderr.on('data', function (data) {
                console.log("**********************************");
                console.log('stdERR: ' + data);
            });
           
            req.app.get('runningWorkspaces')[req.user + '/' + workspaceName] = {
                killTimeout: createWorkspaceKillTimeout(req, workspace, workspaceName),
                process: workspace,
                name: workspaceName,
                url: req.app.settings.baseUrl + ":" + nextFreePort,
                user: req.user
            };
           
            res.json({msg: "Attempted to start workspace", user: req.user, url: req.app.settings.baseUrl + ":" + nextFreePort}); 
       });
   } else {
       console.log("Found running workspace", req.app.get('runningWorkspaces')[req.user + '/' + workspaceName].url);
       res.json({msg: "Found running workspace", user: req.user, url: req.app.get('runningWorkspaces')[req.user + '/' + workspaceName].url});
   }
   
 };

/*
 * POST to keep the workspace alive
*/
 exports.keepAlive = function(req, res) {
   var workspace = req.app.get('runningWorkspaces')[req.user + '/' + req.params.name];
   clearTimeout(workspace.killTimeout);
   workspace.killTimeout = createWorkspaceKillTimeout(req, workspace.process, workspace.name);
   res.send();
 };
