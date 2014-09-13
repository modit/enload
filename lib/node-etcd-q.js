var Q       = require('q')
  , Etcd    = require('node-etcd')
  , util    = require('util')
  , events  = require('events')
;

//Etcd methods to convert
[
  'set',
  'get',
  'create',
  'post',
  'del',
  'delete',
  'mkdir',
  'rmdir',
  'compareAndSwap',
  'testAndSet',
  'compareAndDelete',
  'testAndDelete',
  'raw',
  'watch',
  'watchIndex',
  'watcher',
  'machines',
  'leader',
  'leaderStats',
  'selfStats',
  'version',
].forEach(function(method){
  Etcd.prototype[method + 'Q'] = function(){ return Q.npost(this, method, arguments); };
});

Etcd.prototype.convertResultToJSON = function(result, root){
  var json = {};
  var nodes = [result.node];
  var node;
  
  root = root || result.node.key;
  
  function setRefValue(key, value){
    var parts = key.replace(root + '/', '').split('/');
    var ref = parts.pop();
    
    parts.reduce(function(parent, key){
      parent[key] = parent[key] || {};
      return parent[key];
    }, json)[ref] = value;
  }
  
  while(nodes.length){
    node = nodes.shift();
    if(node.value){
      setRefValue(node.key, node.value);
    }
    nodes.unshift.apply(nodes, node.nodes);
  }
  return json;
};

function StateWatcher(etcd, path, options){
  var self = this, timeout;
  
  (function init(){
    clearTimeout(timeout);
    
    etcd.getQ(path, options).spread(function(result, headers){
      self.emit('state', result);
      
      var watcher = etcd.watcher(path, parseInt(headers['x-etcd-index']) + 1, JSON.parse(JSON.stringify(options))); //JSON to make copy
      
      console.log('Watching state for path', path);
      
      function requestTimeout(){
        clearTimeout(timeout);
        
        timeout = setTimeout(function(){
          console.log('State watcher timeout');
          watcher.stop();
        }, process.env.MAX_STATE_WATCHER_TIMEOUT || 60000);
      }
    
      ['change', 'expire', 'stop', 'error'].forEach(function(event){
        watcher.on(event, function(){
          requestTimeout();
          self.emit.apply(self, [event].concat([].slice.call(arguments)));
        });
      });
      
      watcher.on('reconnect', function(error){
        console.log('State watcher reconnecting');
        
        if(error.errorCode === 401){
          watcher.stop();
        } else {
          requestTimeout();
        }
        
      });
      
      watcher.on('stop', function(){
        init();
      });
      
      requestTimeout();
    }).catch(function(error){
      //path has not been initiliazed yet
      if(error.errorCode === 100){
        return etcd.mkdirQ(path, { prevExist: false }).catch(function(error){
          if(error.errorCode !== 105) { return Q.reject(error); }
        }).then(init);
      }
      return Q.reject(error);
    }).catch(function(error){
      self.emit('error', error);
    });
  })();
}
util.inherits(StateWatcher, events.EventEmitter);

Etcd.prototype.stateWatcher = function(path, options){
  return new StateWatcher(this, path, options);
};

module.exports = Etcd;