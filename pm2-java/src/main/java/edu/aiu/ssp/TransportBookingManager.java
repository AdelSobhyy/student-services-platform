package edu.aiu.ssp;

import java.time.*;

public record TransportBookingManager(
    IAccount account,
    RouteManager routes,
    ITransportDB db,
    IPayment payment,
    ICommunication comm,
    Identifiers ids) {
  public TransportBooking bookSeat(String studentId, String scheduleId) {
    if (!account.verifyStudent(studentId)) throw new UnauthorizedStudentException();
    RouteSchedule schedule = routes.getSchedule(scheduleId);
    if (schedule == null || schedule.seatsAvailable() <= 0) throw new NoSeatAvailableException();
    TransportBooking booking =
        new TransportBooking(
            ids.next("transport"),
            studentId,
            scheduleId,
            schedule.nextSeat(),
            schedule.fare(),
            Lifecycle.TransportBooking.next("INITIAL", "book"));
    db.saveBooking(booking);
    boolean paid = payment.payFees(studentId, "TRANSPORT", booking.id(), booking.amount());
    TransportBooking result = booking.after(paid ? "paid" : "declined");
    db.updateBookingStatus(result.id(), result.status());
    if (paid) {
      routes.updateSeatsAvailable(schedule, -1);
      comm.sendNotification(studentId, "Seat " + result.seatNumber() + " confirmed");
    }
    return result;
  }
}
