package edu.aiu.ssp;

import java.time.*;

public record ClubBrowser(IClubDB db) {
  public Club getClub(String id) {
    return db.findClub(id);
  }
}
