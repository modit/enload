var http      = require('http')
  , https     = require('https')
  , httpProxy = require('http-proxy')
  , Etcd      = require('./node-etcd-q')
  , Q         = require('q')
  , extend    = require('extend')
  , fs        = require('fs')
  , grace     = require('./grace');

function Server(config){
  this.config = config;
  this.config.ssl.options = getSSLOptions(this.config.ssl);
  this.config.etcd.ssl.options = getSSLOptions(this.config.etcd.ssl);
  
  this.etcd   = new Etcd(this.config.etcd.host, this.config.etcd.port, this.config.etcd.ssl.options);
  this.proxy  = httpProxy.createProxyServer({});
  this.servers = [];
}

Server.prototype.run = function(debug){
  var server = this;
  
  console.log(process.pid, 'Starting Server');
  console.log(process.pid, 'ETCD Host', this.config.etcd.host);
  console.log(process.pid, 'ETCD Port', this.config.etcd.port);
  
  server.getRecords().then(function(){
    //For each address and port create a listening server
    server.config.addresses.forEach(function(address){
      server.config.ports.forEach(function(port){
        server.createServer(port, address, debug);
      });
    });
  }).then(function(){
    grace(server.servers);
  }).catch(function(error){
    console.log(error);
    throw 'Server failed to start';
  });
};

Server.prototype.createServer = function(port, address, debug){
  var server = this
    , httpServer;
    
  function handleHTTPRequest(req, res){
    //get target and then proxy request
    server.getTarget(req.socket.remoteAddress, req.headers.host, port).then(function(target){
      if(target.redirect){
        res.writeHead(302, { 'Location': target.redirect });
        res.end();
      } else {
        server.proxy.web(req, res, {
          target: 'http://' + target.url,
          xfwd: true
        });
      }
    }).catch(function(error){
      console.log(error);
      res.write('Error: ' + error);
      res.end();
    });
  }
  
  function handleWSRequest(req, socket, head){
    //get target and then proxy request
    server.getTarget(req.socket.remoteAddress, req.headers.host, port).then(function(target){
      if(target.redirect){
        res.writeHead(302, { 'Location': target.redirect });
        res.end();
      } else {
        server.proxy.ws(req, socket, head, {
          target: 'ws://' + target.url,
          xfwd: true
        });
      }
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
  
  this.servers.push(httpServer);
};

Server.prototype.getTarget = function(ip, host, port){
  var server = this;
  //Ensure that a port is given, port 80 and 443 are not always
  var key = host.replace(/:.*/, '') + ':' + port;
  
  return Q.fcall(function(){
    return server.getRecord(key);
  }).then(function(record){
    if(record.redirect){
      return { redirect: record.redirect };
    } else {
      return { url: selectTarget(ip, record.targets) };
    }
  });
};

Server.prototype.getRecords = function(){
  var server = this;
  return server.etcd.getQ(server.config.etcd.directory, { recursive: true }).spread(function(result){
    server.records = server.etcd.convertResultToJSON(result);
    server.watcher = server.etcd.watcher(server.config.etcd.directory, result.modifiedIndex, { recursive: true });
    
    server.watcher.on('change', function(change){
      console.log('Updating record');
      try{
        
        if(change.action === 'set'){
          change = server.etcd.convertResultToJSON(change, '/' + server.config.etcd.directory);
          extend(true, server.records, change);
        }else if(change.action === 'delete'){
          var parts = change.node.key.replace('/' + server.config.etcd.directory + '/', '').split('/');
          delete parts.slice(0, -1).reduce(function(parent, key){
            return parent[key];
          }, server.records)[parts.pop()];
        }
      
      }catch(e){
        console.log('Failed to update record', change, error);
      }

    });
  });
};

Server.prototype.getRecord = function(host){
  var server = this;
  
  var parts     = host.split(':')
    , hostname  = parts[0]
    , port      = parts[1] || 80
    , domain    = hostname.split('.').slice(-2).join('.');
  
  return Q.fcall(function(){
    var domainRecord = server.records.domains[domain];
    
    if(!domainRecord){
      throw 'Domain not configured';
    } else if(hostname === domain) {
      return domainRecord;
    }else if(domainRecord.subdomains){
      var subs = getPossibleSubDomains(hostname);
      
      return Q.fcall(function iterate(){
        return domainRecord.subdomains[subs.shift()] || (subs.length && iterate());
      });
    }
  }).then(function(record){
    if(!record){ throw 'Subdomain not configured'; }

    if(record.alias) {
      return server.getRecord(record.alias + ':' + port);
    } else if (record.redirect) {
      return record;
    } else if (record.ports) {
      return record.ports[port];
    }
    
  }).then(function(record){
    if(!record) { throw 'Subdomain not configured'; }
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

function selectTarget(ip, targets){
  //TODO: verify that load is distributed evenly across all targets
  var hash = ip.split(/\./g).reduce(function(r, num) {
    r += parseInt(num, 10);
    r %= 2147483648;
    r += (r << 10);
    r %= 2147483648;
    r ^= r >> 6;
    return r;
  }, 0);

  hash += hash << 3;
  hash %= 2147483648;
  hash ^= hash >> 11;
  hash += hash << 15;
  hash %= 2147483648;

  hash = hash >>> 0;
  
  
  var keys = Object.keys(targets);
  if(keys.length){
    return keys[hash % keys.length];
  } else {
    throw 'No Target';
  }
}

module.exports = Server;