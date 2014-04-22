var Q = require('q')
  , Etcd = require('node-etcd');

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

module.exports = Etcd;