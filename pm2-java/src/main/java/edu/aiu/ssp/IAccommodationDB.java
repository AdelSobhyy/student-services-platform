package edu.aiu.ssp;

import java.time.*;

public interface IAccommodationDB {
  Room findRoom(String id);

  void saveRoom(Room room);

  boolean overlaps(String roomId, Dates dates);

  void saveBooking(Booking booking);

  Booking findBooking(String id);

  void updateBookingStatus(String id, String status);

  void updateRoomStatus(String id, String status);
}
