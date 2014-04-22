var http      = require('http')
  , https     = require('https')
  , httpProxy = require('http-proxy')
  , Etcd      = require('./node-etcd-q')
  , Q         = require('q')
  , extend    = require('extend')
  , LRU       = require("lru-cache")
  , fs        = require('fs');

function Server(config){
  this.config = config;
  this.config.ssl.options = getSSLOptions(this.config.ssl);
  this.config.etcd.ssl.options = getSSLOptions(this.config.etcd.ssl);
  
  this.lru    = LRU({ max: 1000, maxAge: this.config.ttl });
  this.etcd   = new Etcd(this.config.etcd.host, this.config.etcd.port, this.config.etcd.ssl.options);
  this.proxy  = httpProxy.createProxyServer({});
}

Server.prototype.run = function(){
  console.log(process.pid, 'Starting Server');
  console.log(process.pid, 'ETCD Host', this.config.etcd.host);
  console.log(process.pid, 'ETCD Port', this.config.etcd.port);
  
  //For each address and port create a listening server
  this.config.addresses.forEach(function(address){
    this.config.ports.forEach(function(port){
      this.createServer(port, address);
    }, this);
  }, this);
};

Server.prototype.createServer = function(port, address){
  var server = this
    , httpServer;
    
  function handleHTTPRequest(req, res){
    //get target and then proxy request
    server.getTarget(req.headers.host, port).then(function(target){
      server.proxy.web(req, res, {
        target: 'http://' + target,
        xfwd: true
      });
    }).catch(function(error){
      console.log(error);
      res.write('Error: ' + error);
      res.end();
    });
  }
  
  function handleWSRequest(req, socket, head){
    //get target and then proxy request
    server.getTarget(req.headers.host, port).then(function(target){
      server.proxy.ws(req, socket, head, {
        target: 'ws://' + target,
        xfwd: true
      });
    });
  }
  
  if(server.config.ssl.ports.indexOf(port) !== -1){
    httpServer = https.createServer(server.config.ssl.options, handleHTTPRequest);
  }else{
    httpServer = http.createServer(handleHTTPRequest);
  }
  //Websockets upgrade
  httpServer.on('upgrade', handleWSRequest);

  httpServer.listen(port, address);
  console.log(process.pid, 'Listening on ' + address + ':' + port);
};

Server.prototype.getTarget = function(host, port){
  var server = this;
  //Ensure that a port is given, port 80 and 443 are not always
  var key = host.replace(/:.*/, '') + ':' + port;
  
  return Q.fcall(function(){
    return server.lru.get(key) || server.getRecord(key);
  }).then(function(record){
    return selectRandomTarget(record.targets);
  });
};

Server.prototype.getRecord = function(host){
  var server = this;
  
  var parts     = host.split(':')
    , hostname  = parts[0]
    , port      = parts[1] || 80
    , domain    = hostname.split('.').slice(-2).join('.')
    , dir       = server.config.etcd.directory + '/domains/' + domain;
  
  return Q.fcall(function(){
    if(hostname === domain) {//single level domain
      return server.etcd.getQ(dir + '/ports/' + port, { recursive: true }).catch(function(error){
        if(error.errorCode === 100) throw 'No Match';
        else throw error.message;
      });
    } else {
      var subs = getPossibleSubDomains(hostname);
      return Q.fcall(function recurse(sub){
        var key = dir + '/subdomains/' + sub + '/ports/' + port;
        
        
        return server.etcd.getQ(key, { recursive: true }).catch(function(error){
          if(subs.length) return recurse(subs.shift());
          else if(error.errorCode === 100) throw 'No Match';
          else throw error.message;
         });
      }, subs.shift());
    }
  }).spread(function(result, headers){
    data = server.etcd.convertResultToJSON(result);
    return data.alias ? server.getRecord(data.alias) : data;
  }).then(function(record){
    server.lru.set(host, record);
    return record;
  });
};


function getSSLOptions(config){
  var options = {};
  if(config.key) options.key = fs.readFileSync(config.key);
  if(config.cert) options.cert = fs.readFileSync(config.cert);
  if(config.ca) options.ca = [].concat(config.ca).map(function(ca){
    return fs.readFileSync(ca);
  });
  return options.cert && options.key && options;
}

function getPossibleSubDomains(hostname){
  var parts = hostname.split('.');
  var subs = [];
  
  //foo.bar.example.com => [foo.bar, *.bar, *]
  //bar.example.com => [bar, *]
  //example.com => []
  
  if(parts.length > 2) {
    subs.push(parts.slice(0, -2).join('.'));
    
    for(var i = 1, l = parts.length - 1; i < l; i++){
      subs.push(['*'].concat(parts.slice(i, -2)).join('.'));
    }
  }
  
  return subs;
}

function selectRandomTarget(targets){
  var host
    , random
    , totalWeight = 0;
  
  try{
    for(host in targets){
      totalWeight += targets[host];
    }
    random = Math.random() * totalWeight;
    
    if(!totalWeight) throw "No Target";
    
    for(host in targets){
      if(random < targets[host]) return host;
    }
    
  }catch(e){
    throw 'Invalid Record';
  }
}

module.exports = Server;
