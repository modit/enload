FROM stackbrew/ubuntu:latest

EXPOSE 80

RUN apt-get update
RUN apt-get install -y wget git
RUN wget -O - http://nodejs.org/dist/v0.10.25/node-v0.10.25-linux-x64.tar.gz | tar -C /usr/local/ --strip-components=1 -zxv
RUN npm install git+https://github.com/shannonmpoole/etcd-load-balancer.git -g

ADD docker.sh docker.sh
ENTRYPOINT ["docker.sh"]
