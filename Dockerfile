FROM stackbrew/ubuntu:latest

RUN apt-get update
RUN apt-get install -y wget
RUN wget -O - http://nodejs.org/dist/v0.10.25/node-v0.10.25-linux-x64.tar.gz | tar -C /usr/local/ --strip-components=1 -zxv

ADD . /src/etcdlb
RUN npm install -g /src/etcdlb

EXPOSE 80

ENTRYPOINT ["enload-docker"]