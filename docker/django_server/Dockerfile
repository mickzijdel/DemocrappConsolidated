FROM python:3.8.18
WORKDIR /srv/api
ADD DemocrApp-API/requirements.txt /srv/api
RUN pip install -r requirements.txt
ADD DemocrApp-API/. /srv/api
ADD docker/django_server/settings.py /srv/api/democrapp_api/.
CMD ["python", "-V"]
