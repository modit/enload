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

Etcd.prototype.convertResultToJSON = function(result){
  var json = {};
  var root = result.node.key;
  var nodes = result.node.nodes.slice() || [];
  var node;
  
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

function Fetcher(etcd, path, options){
  var fetcher = this;
  
  (function init(){
    
    etcd.getQ(path, options).spread(function(result, headers){

      var watcher = etcd.watcher(path, headers['x-etcd-index'] + 1, options);
    
      ['change', 'expire', 'stop', 'error'].forEach(function(event){
        watcher.on(event, function(){
          fetcher.emit.apply(fetcher, [event].concat([].slice.call(arguments)));
        });
      });
      
      watcher.on('reconnect', function(error){
        if(error.errorCode === 401){
          watcher.stop();
          init();
        }
      });
      
      fetcher.emit('fetch', result);
    }).catch(function(error){
      //path has not been initiliazed yet
      if(error.errorCode === 100){
        return etcd.mkdirQ(path, { prevExist: false }).catch(function(error){
          if(error.errorCode !== 105) { return Q.reject(error); }
        }).then(init);
      }
      return Q.reject(error);
    }).catch(function(error){
      fetcher.emit('error', error);
    });
  })();
}
util.inherits(Fetcher, events.EventEmitter);

Etcd.prototype.fetcher = function(path, options){
  return new Fetcher(this, path, options);
};

module.exports = Etcd;