import gspread

from utils import get_credentials, db_connect
from models import DeclarativeBase


def create_tables(engine):
    """Creates tables in database"""
    DeclarativeBase.metadata.create_all(engine)


def update_db():
    engine = db_connect()
    create_tables(engine)


def main():
    update_db()
    credentials = get_credentials()
    gc = gspread.authorize(credentials)

    workbook = gc.open("Hymn Singing Responses")
    wks_sacrament = workbook.worksheet("Sacrament Meeting")
    wks_other = workbook.worksheet("Other Meetings")
    wks_hymns = workbook.worksheet("Hymns")

    foo = wks_sacrament.get_all_values()
    print(foo[44])
    dates = wks_sacrament.col_values(2)
    print(dates)


if __name__ == "__main__":
    main()
