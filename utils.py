import os
import json
from pathlib import Path

from oauth2client.service_account import ServiceAccountCredentials
from sqlalchemy import create_engine

from models import DeclarativeBase


def get_credentials():
    scope = ['https://spreadsheets.google.com/feeds']
    keyfile = 'hymn-stats-keyfile.json'
    if Path(keyfile).is_file():
        credentials = ServiceAccountCredentials.from_json_keyfile_name(keyfile, scope)
    else:
        keyfile_dict = {
            "type": os.environ['GSHEETS_TYPE'],
            "project_id": os.environ['GSHEETS_PROJECT_ID'],
            "private_key_id": os.environ['GSHEETS_PRIVATE_KEY_ID'],
            "private_key": os.environ['GSHEETS_PRIVATE_KEY'],
            "client_email": os.environ['GSHEETS_CLIENT_EMAIL'],
            "client_id": os.environ['GSHEETS_CLIENT_ID'],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://accounts.google.com/o/oauth2/token",
            "auth_provider_x509_cert_url": os.environ['GSHEETS_AUTH_PROVIDER_X509_CERT_URL'],
            "client_x509_cert_url": os.environ['GSHEETS_CLIENT_X509_CERT_URL']
        }
        credentials = ServiceAccountCredentials.from_json_keyfile_dict(keyfile_dict, scope)
    return credentials


def db_connect():
    """
    Performs database connection using database settings from settings.py.
    Returns sqlalchemy engine instance
    """
    db_creds = 'db_creds.json'
    if Path(db_creds).is_file():
        with open(db_creds) as data_file:
            data = json.load(data_file)
        db_url = data['db_url']
    else:
        db_url = os.environ['DATABASE_URL']
    # print('INFO: Connecting to DB:', db_url)
    return create_engine(db_url)


def create_tables(engine):
    """Creates tables in database"""
    DeclarativeBase.metadata.create_all(engine)
