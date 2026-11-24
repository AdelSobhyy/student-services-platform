package edu.aiu.ssp;

import java.time.*;

public interface ILibraryDB {
  Resource findResourceById(String id);

  void saveReservation(Reservation reservation);

  void updateCopies(String id, int delta);

  void logDownload(String resourceId, String studentId);
}
