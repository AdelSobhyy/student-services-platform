package edu.aiu.ssp;

import java.time.*;

public interface ILibraryDB {
  Resource findResourceById(String id);

  void saveReservation(Reservation reservation);

  Reservation findReservation(String id);

  void updateReservationStatus(String id, String status);

  void updateCopies(String id, int delta);

  void logDownload(String resourceId, String studentId);
}
