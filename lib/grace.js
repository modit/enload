module.exports = function(servers){
	servers = (servers instanceof Array ? servers : [].slice.call(arguments));

	//===Graceful Shutdown===============================================================
	// this function is called when you want the server to die gracefully
	// i.e. wait for existing connections
	function gracefulShutdown() {
    console.log('Received kill signal, shutting down gracefully.');
    
    servers.reverse().reduce(function(cb, server){
      return function(){
        server.close(cb);
      };
    }, function(){
      console.log('All Servers closed out remaining connections.');
      process.exit();
    })();

    // if after
    setTimeout(function() {
      console.error("Could not close connections in time, forcefully shutting down");
      process.exit();
    }, 10 * 1000);
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