package edu.aiu.ssp;

import java.time.*;

public interface ITransportDB {
  RouteSchedule findSchedule(String id);

  void saveBooking(TransportBooking booking);

  TransportBooking findBooking(String id);

  void updateBookingStatus(String id, String status);

  void saveSeatsAvailable(String id, int seats);
}
