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
      comm.sendNotification(studentId, "Seat " + booking.seatNumber() + " confirmed");
    }
    return result;
  }

  /** CONFIRMED -> CANCELLED; releases the reserved seat and notifies the student. */
  public TransportBooking cancelBooking(String bookingId) {
    TransportBooking current = db.findBooking(bookingId);
    if (current == null) throw new ValidationException();
    TransportBooking result = current.after("cancel");
    db.updateBookingStatus(result.id(), result.status());
    RouteSchedule schedule = routes.getSchedule(current.scheduleId());
    if (schedule != null) routes.updateSeatsAvailable(schedule, 1);
    comm.sendNotification(current.studentId(), "Seat " + result.seatNumber() + " released");
    return result;
  }

  /** CONFIRMED -> COMPLETED when the trip date passes. */
  public TransportBooking complete(String bookingId) {
    TransportBooking current = db.findBooking(bookingId);
    if (current == null) throw new ValidationException();
    TransportBooking result = current.after("complete");
    db.updateBookingStatus(result.id(), result.status());
    comm.sendNotification(current.studentId(), "Trip " + result.id() + " completed");
    return result;
  }
}
