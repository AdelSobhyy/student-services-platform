package edu.aiu.ssp;

import java.time.*;

public record BookingManager(
    IAccount account,
    InventoryManager inventory,
    IAccommodationDB db,
    IPayment payment,
    ICommunication comm,
    Identifiers ids) {
  public Booking bookRoom(String studentId, String roomId, Dates dates) {
    if (!account.verifyStudent(studentId)) throw new UnauthorizedStudentException();
    Room room = inventory.isAvailable(roomId, dates);
    if (room == null) throw new RoomNotAvailableException();
    Booking booking =
        new Booking(
            ids.next("booking"),
            studentId,
            roomId,
            dates,
            room.price(),
            Lifecycle.Booking.next("INITIAL", "book"));
    db.saveBooking(booking);
    boolean paid = payment.payFees(studentId, "HOUSING", booking.id(), booking.amount());
    Booking result = booking.after(paid ? "paid" : "declined");
    db.updateBookingStatus(result.id(), result.status());
    if (paid) {
      inventory.updateAvailability(roomId, "BOOKED");
      comm.sendNotification(studentId, "Booking " + result.id() + " confirmed");
    }
    return result;
  }

  /** CONFIRMED/PENDING -> CANCELLED; restores room availability and notifies the student. */
  public Booking cancelBooking(String bookingId) {
    Booking current = db.findBooking(bookingId);
    if (current == null) throw new ValidationException();
    Booking result = current.after("cancel");
    db.updateBookingStatus(result.id(), result.status());
    inventory.updateAvailability(current.roomId(), "AVAILABLE");
    comm.sendNotification(current.studentId(), "Booking " + result.id() + " cancelled");
    return result;
  }

  /** CONFIRMED -> COMPLETED when the check-out date is reached. */
  public Booking checkout(String bookingId) {
    Booking current = db.findBooking(bookingId);
    if (current == null) throw new ValidationException();
    Booking result = current.after("checkout");
    db.updateBookingStatus(result.id(), result.status());
    comm.sendNotification(current.studentId(), "Booking " + result.id() + " completed");
    return result;
  }
}
