module.exports = function(items){
	items = (items instanceof Array ? items : [].slice.call(arguments));

	//===Graceful Shutdown===============================================================
	// this function is called when you want the server to die gracefully
	// i.e. wait for existing connections
	function gracefulShutdown() {
    console.log('Received kill signal, shutting down gracefully.');
    
    items.reverse().reduce(function(cb, item){
      return function(){
        try{
          if(item.close){
            item.close(cb);
          } else if(typeof item === 'function'){
            item(cb);
          } else {
            cb();
          }
        }catch(e){
          if(e.toString().indexOf('Not running') === -1){ throw e; }
          cb();
        }
      };
    }, function(){
      console.log('All items shutdown.');
      process.exit();
    })();

    // if after
    setTimeout(function() {
      console.error("Could not shutdown all items, forcefully shutting down");
      process.exit();
    }, process.env.GRACE_TIMEOUT || 10 * 1000);
  }

  // listen for TERM signal .e.g. kill
  process.on('SIGTERM', gracefulShutdown);

  // listen for INT signal e.g. Ctrl-C
  process.on('SIGINT', gracefulShutdown);

  process.on('uncaughtException', function (error) {
    console.error('An uncaughtException was found, this process will end.', error);
    gracefulShutdown();
  });
};