package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;
import java.util.List;

/** Named instances of every object in the PM2 object model, shared by all unit tests. */
final class Fixtures {
  static final String STUDENT = "S-103";
  static final String ADMIN = "U-900";
  static final BigDecimal FEE = new BigDecimal("3500.00");
  static final BigDecimal FARE = new BigDecimal("25.00");
  static final Dates DATES =
      new Dates(LocalDate.parse("2026-09-20"), LocalDate.parse("2027-01-20"));

  static final User USER_ACTIVE = new User(STUDENT, "Emad Mohamed", "emad@student.edu", "hash", "ACTIVE");
  static final User USER_SUSPENDED =
      new User(STUDENT, "Emad Mohamed", "emad@student.edu", "hash", "SUSPENDED");
  static final User USER_DEACTIVATED =
      new User(STUDENT, "Emad Mohamed", "emad@student.edu", "hash", "DEACTIVATED");
  static final UserData DATA = new UserData("Emad Mohamed", "emad@student.edu", "Campus2026!");

  static final Room ROOM = new Room("R-204", "B-204", 2, 1, FEE, "AVAILABLE");
  static final Room ROOM_BOOKED = new Room("R-204", "B-204", 2, 0, FEE, "BOOKED");
  static final Room ROOM_MAINTENANCE = new Room("R-204", "B-204", 2, 0, FEE, "MAINTENANCE");

  static final Booking BOOKING_CONFIRMED =
      new Booking("B-5001", STUDENT, "R-204", DATES, FEE, "CONFIRMED");
  static final TransportBooking TRANSPORT_CONFIRMED =
      new TransportBooking("TB-9001", STUDENT, "SCH-77", 29, FARE, "CONFIRMED");

  static final Route ROUTE = new Route("RT-3", "Campus — Nasr City", "Campus", "Nasr City");

  static RouteSchedule schedule(int seats) {
    return new RouteSchedule(
        "SCH-77",
        ROUTE,
        LocalDate.parse("2026-10-05"),
        LocalTime.parse("07:30"),
        LocalTime.parse("08:45"),
        seats,
        29,
        FARE);
  }

  static final Club ROBOTICS = new Club("C-12", "Robotics Club", "Technology", "S-210", "APPROVED");
  static final Club PENDING_CLUB = new Club("C-15", "Photography Club", "Arts", "S-215", "PENDING");
  static final Club SUSPENDED_CLUB =
      new Club("C-15", "Photography Club", "Arts", "S-215", "SUSPENDED");
  static final Club ROBOTICS_SUSPENDED =
      new Club("C-12", "Robotics Club", "Technology", "S-210", "SUSPENDED");
  static final Membership MEMBERSHIP_ACTIVE = new Membership("M-301", STUDENT, "C-12", "ACTIVE");
  static final Membership MEMBERSHIP_LEFT = new Membership("M-301", STUDENT, "C-12", "LEFT");

  static final Meal CHICKEN =
      new Meal("M-55", "Grilled Chicken Plate", new BigDecimal("65.00"), "AVAILABLE", List.of());
  static final Meal CHICKEN_OUT =
      new Meal("M-55", "Grilled Chicken Plate", new BigDecimal("65.00"), "OUT_OF_STOCK", List.of());
  static final Meal NOODLES =
      new Meal(
          "M-71",
          "Peanut Noodles",
          new BigDecimal("55.00"),
          "AVAILABLE",
          List.of(new Ingredient("I-9", "Peanuts"), new Ingredient("I-4", "Wheat noodles")));
  static final DietaryRestriction ALLERGY =
      new DietaryRestriction("DR-2", "Peanut Allergy", "ALLERGY", "I-9");
  static final MealOrder ORDER_PAID =
      new MealOrder("O-7001", STUDENT, "M-55", CHICKEN.price(), List.of(), "PAID");

  static final Payment PAYMENT_PAID =
      new Payment("P-9001", STUDENT, "HOUSING", "B-5001", FEE, "PAID");
  static final Payment PAYMENT_FAILED =
      new Payment("P-9001", STUDENT, "HOUSING", "B-5001", FEE, "FAILED");
  static final Refund REFUND_REQUESTED =
      new Refund("RF-1", "P-9001", STUDENT, FEE, "REQUESTED");
  static final Refund REFUND_APPROVED =
      new Refund("RF-1", "P-9001", STUDENT, FEE, "APPROVED");

  static final String SUBJECT = "Cannot cancel booking";
  static final String DESCRIPTION = "Cancel button is disabled";
  static final SupportTicket TICKET_OPEN =
      new SupportTicket("T-401", STUDENT, SUBJECT, DESCRIPTION, "OPEN");
  static final SupportTicket TICKET_IN_PROGRESS =
      new SupportTicket("T-401", STUDENT, SUBJECT, DESCRIPTION, "IN_PROGRESS");
  static final SupportTicket TICKET_RESOLVED =
      new SupportTicket("T-401", STUDENT, SUBJECT, DESCRIPTION, "RESOLVED");

  static final Notification NOTIFICATION_SENT =
      new Notification("N-88", STUDENT, "TICKET_CREATED", "Ticket received", "EMAIL", "SENT");
  static final Notification NOTIFICATION_FAILED =
      new Notification("N-88", STUDENT, "TICKET_CREATED", "Ticket received", "EMAIL", "FAILED");

  static Resource book(int copies) {
    return new Resource("L-300", "PRINTED_BOOK", "Clean Code", copies, true);
  }

  static final Resource EBOOK = new Resource("L-301", "DIGITAL", "Clean Code", 0, true);
  static final Reservation RESERVATION_RESERVED =
      new Reservation("RS-12", STUDENT, "L-300", "RESERVED");
  static final Reservation RESERVATION_COLLECTED =
      new Reservation("RS-12", STUDENT, "L-300", "COLLECTED");
}
