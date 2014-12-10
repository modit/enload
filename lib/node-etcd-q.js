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
  this.etcd = etcd;
  this.path = path;
  this.options = JSON.parse(JSON.stringify(options)); //JSON poor man's copy
  
  this.start();
}
util.inherits(StateWatcher, events.EventEmitter);

StateWatcher.prototype.start = function(){
  var self = this;
  
  if(self.watcher){
    self.watcher.stop();
    delete self.watcher;
  }
  
  this.sync().then(function(){
    self.watcher = self.etcd.watcher(self.path, self.index + 1, JSON.parse(JSON.stringify(self.options)));

    console.log('Watching state for path', self.path);
  
    ['change', 'expire', 'stop', 'error'].forEach(function(evt){
      self.watcher.on(evt, function(data){
        self.emit.apply(self, [evt].concat([].slice.call(arguments)));
      });
    });
    
    
    self.watcher.on('resync', function(){
      self.sync();
    });
    
  }).catch(console.warn);
};

StateWatcher.prototype.sync = function(){
  var self = this;
  
  return self.etcd.getQ(this.path, this.options).spread(function(result, headers){
    self.index = parseInt(headers['x-etcd-index']);
    self.emit('state', result);
  }).catch(function(error){
    //path has not been initialized yet
    if(error.errorCode === 100){
      return etcd.mkdirQ(path, { prevExist: false }).catch(function(error){
        if(error.errorCode !== 105) { return Q.reject(error); }
      }).then(function(){
        return self.sync(callback);
      });
    }
    return Q.reject(error);
  }).catch(function(error){
    self.emit('error', error);
  });
};

Etcd.prototype.stateWatcher = function(path, options){
  return new StateWatcher(this, path, options);
};

module.exports = Etcd;