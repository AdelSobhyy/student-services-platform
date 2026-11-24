package edu.aiu.ssp;

import java.time.*;

public record RouteManager(ITransportDB db) {
  public RouteSchedule getSchedule(String id) {
    return db.findSchedule(id);
  }

  public void updateSeatsAvailable(RouteSchedule schedule, int delta) {
    int seats = schedule.seatsAvailable() + delta;
    if (seats < 0) throw new NoSeatAvailableException();
    db.saveSeatsAvailable(schedule.id(), seats);
  }
}
