from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.ext.declarative import declarative_base

DeclarativeBase = declarative_base()


class SacramentMeeting(DeclarativeBase):
    """Sacrament Meeting model"""
    __tablename__ = "sacrament_meeting"

    id = Column(Integer, primary_key=True)
    date = Column('date', DateTime)

    opening_hymn = Column('opening_hymn', String, nullable=True)
    opening_tempo = Column('opening_tempo', String, nullable=True)
    opening_above_beyond = Column('opening_above_beyond', String, nullable=True)

    sacrament_hymn = Column('sacrament_hymn', String, nullable=True)
    sacrament_tempo = Column('sacrament_tempo', String, nullable=True)
    sacrament_above_beyond = Column('sacrament_above_beyond', String, nullable=True)

    congregational_hymn = Column('congregational_hymn', String, nullable=True)
    congregational_tempo = Column('congregational_tempo', String, nullable=True)
    congregational_above_beyond = Column('congregational_above_beyond', String, nullable=True)
    congregational_type = Column('congregational_type', String, nullable=True)
    congregational_stood = Column('congregational_stood', String, nullable=True)

    closing_hymn = Column('closing_hymn', String, nullable=True)
    closing_tempo = Column('closing_tempo', String, nullable=True)
    closing_above_beyond = Column('closing_above_beyond', String, nullable=True)

    ward = Column('ward', String, nullable=True)
    sunday_type = Column('sunday_type', String, nullable=True)
    holiday = Column('holiday', String, nullable=True)
    chorister = Column('chorister', String, nullable=True)


class OtherMeetings(DeclarativeBase):
    """Other Meetings model"""
    __tablename__ = "other_meeting"

    id = Column(Integer, primary_key=True)
    date = Column('date', DateTime)

    ward = Column('ward', String, nullable=True)
    meeting = Column('meeting', String, nullable=True)

    hymn_1 = Column('hymn_1', String, nullable=True)
    hymn_1_tempo = Column('hymn_1_tempo', String, nullable=True)
    hymn_1_verses = Column('hymn_1_verses', String, nullable=True)

    hymn_2 = Column('hymn_2', String, nullable=True)
    hymn_2_tempo = Column('hymn_2_tempo', String, nullable=True)
    hymn_2_verses = Column('hymn_2_verses', String, nullable=True)

    hymn_3 = Column('hymn_3', String, nullable=True)
    hymn_3_tempo = Column('hymn_3_tempo', String, nullable=True)
    hymn_3_verses = Column('hymn_3_verses', String, nullable=True)


class Hymnbook(DeclarativeBase):
    """Hymnbook model"""
    __tablename__ = "hymnbook"

    id = Column(Integer, primary_key=True)
    hymn_number = Column('hymn_number', String)
    hymn_name = Column('hymn_name', String)

    scriptures = Column('scriptures', String, nullable=True)
    text_author = Column('text_author', String, nullable=True)
    music_composer = Column('music_composer', String, nullable=True)

    tempo_low = Column('tempo_low', String)
    tempo_high = Column('tempo_high', String)

    singing_descriptor = Column('singing_descriptor', String, nullable=True)
    meter = Column('meter', String, nullable=True)
    tune = Column('tune', String, nullable=True)
