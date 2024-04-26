FROM node:14-alpine3.13

ADD DemocrApp-UI/package.json /srv/ui/package.json
WORKDIR /srv/ui
RUN yarn install --allow-root --unsafe-perm=true
ADD DemocrApp-UI/. /srv/ui

FROM nginx:1.25
WORKDIR /usr/share/nginx/html
COPY --from=0 /srv/ui/node_modules node_modules/.
COPY --from=0 /srv/ui/src .
COPY docker/nginx/api-endpoint.conf /etc/nginx/conf.d/.
RUN mkdir -p /srv/api/static
RUN chown -R nginx:www-data /srv/api/static