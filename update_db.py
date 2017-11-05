import gspread
from sqlalchemy.orm import sessionmaker

from models import SacramentMeeting, OtherMeetings, Hymnbook
from utils import get_credentials, db_connect, create_tables


def get_db_session():
    engine = db_connect()
    create_tables(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    return session


def main():
    session = get_db_session()
    credentials = get_credentials()
    gc = gspread.authorize(credentials)

    workbook = gc.open("Hymn Singing Responses")
    wks_sacrament = workbook.worksheet("Sacrament Meeting")
    wks_other = workbook.worksheet("Other Meetings")
    wks_hymns = workbook.worksheet("Hymns")

    # foo = wks_sacrament.get_all_values()
    # print(foo[44])
    # dates = wks_sacrament.col_values(2)
    # print(dates)
    hymnal = wks_hymns.get_all_values()
    for hymn in hymnal:
        if not hymn[0].isdigit():
            continue

        session.add(Hymnbook(
            hymn_number=hymn[0],
            hymn_name=hymn[1],
            scriptures=hymn[2],
            text_author=hymn[3],
            music_composer=hymn[4],
            tempo_low=hymn[5],
            tempo_high=hymn[6],
            singing_descriptor=hymn[7],
            meter=hymn[8],
            tune=hymn[9]
            )
        )
        # print(hymn)
    print(len(session.query(Hymnbook).all()))


if __name__ == "__main__":
    main()
