FROM stackbrew/ubuntu:13.10

RUN apt-get update
RUN apt-get install -y software-properties-common
RUN apt-get install -y build-essential
RUN add-apt-repository ppa:chris-lea/node.js
RUN apt-get update
RUN apt-get install -y nodejs

RUN npm install git+https://github.com/shannonmpoole/etcd-load-balancer.git -g

EXPOSE 80
CMD ['etcdlb']