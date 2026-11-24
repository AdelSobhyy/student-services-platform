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
}
