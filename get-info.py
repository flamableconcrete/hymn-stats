import sqlite3

from pprint import pprint

import gspread

from oauth2client.service_account import ServiceAccountCredentials


def main():
    scope = ['https://spreadsheets.google.com/feeds']

    credentials = ServiceAccountCredentials.from_json_keyfile_name('hymn-stats.json', scope)
    gc = gspread.authorize(credentials)

    # Open a worksheet from spreadsheet with one shot
    # wks = gc.open("1G9-fJkrhgyrnYuVhoXZa41goeoA5nb-3Vo1sJ0L-egc").sheet1
    wkbk = gc.open("Hymn Singing Responses")

    sacrament_meeting = wkbk.worksheet("Sacrament Meeting")
    other_meetings = wkbk.worksheet("Other Meetings")

    # Fetch a cell range
    # cell_list = sacrament_meeting.range('A1:T200')
    # for cell in cell_list:
    #     print('cell: ', type(cell), cell)

    cell_list = sacrament_meeting.get_all_values()
    # pprint(cell_list)
    print(cell_list[44])

    # date = sacrament_meeting.col_values(2)
    # pprint(date)


if __name__ == "__main__":
    main()
