import { ITemplateProvider } from './ViteReactProvider';

const REQUIREMENTS = `django>=5.0,<6.0
djangorestframework>=3.15,<4.0
django-cors-headers>=4.3,<5.0
gunicorn>=22.0,<23.0
`;

const MANAGE_PY = `#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'myproject.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
`;

const SETTINGS_PY = `from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = 'django-insecure-change-this-in-production'

DEBUG = True

ALLOWED_HOSTS = ['*']

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
]

ROOT_URLCONF = 'myproject.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

STATIC_URL = 'static/'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CORS_ALLOW_ALL_ORIGINS = True

REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.AllowAny'],
}
`;

const URLS_PY = `from django.urls import path, include

urlpatterns = [
    path('api/', include('api.urls')),
]
`;

const API_VIEWS_PY = `from rest_framework.decorators import api_view
from rest_framework.response import Response
from datetime import datetime


@api_view(['GET'])
def hello(request):
    return Response({
        'message': 'Hello from Django REST!',
        'timestamp': datetime.now().isoformat(),
    })
`;

const API_URLS_PY = `from django.urls import path
from . import views

urlpatterns = [
    path('hello/', views.hello, name='hello'),
]
`;

const API_APPS_PY = `from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'
`;

const INIT_PY = '';

const PROCFILE = `web: gunicorn myproject.wsgi --bind 0.0.0.0:$PORT
`;

const DEV_SH = `#!/bin/bash
# Install dependencies and start Django dev server
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
`;

export class DjangoProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'requirements.txt': REQUIREMENTS,
      'manage.py': MANAGE_PY,
      'Procfile': PROCFILE,
      'dev.sh': DEV_SH,
      'myproject/__init__.py': INIT_PY,
      'myproject/settings.py': SETTINGS_PY,
      'myproject/urls.py': URLS_PY,
      'api/__init__.py': INIT_PY,
      'api/apps.py': API_APPS_PY,
      'api/views.py': API_VIEWS_PY,
      'api/urls.py': API_URLS_PY,
    };
  }
}
