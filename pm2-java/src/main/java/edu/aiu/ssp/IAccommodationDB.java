package edu.aiu.ssp;

import java.time.*;

public interface IAccommodationDB {
  Room findRoom(String id);

  boolean overlaps(String roomId, Dates dates);

  void saveBooking(Booking booking);

  void updateBookingStatus(String id, String status);

  void updateRoomStatus(String id, String status);
}
