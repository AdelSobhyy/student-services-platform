package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;
import java.util.List;

final class Fixtures {
  static final String STUDENT = "S-103";
  static final BigDecimal FEE = new BigDecimal("3500.00");
  static final BigDecimal FARE = new BigDecimal("25.00");
  static final Dates DATES =
      new Dates(LocalDate.parse("2026-09-20"), LocalDate.parse("2027-01-20"));
  static final Room ROOM = new Room("R-204", "B-204", 2, 1, FEE, "AVAILABLE");
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
  static final Meal CHICKEN =
      new Meal("M-55", "Grilled Chicken Plate", new BigDecimal("65.00"), "AVAILABLE", List.of());
  static final Meal NOODLES =
      new Meal(
          "M-71",
          "Peanut Noodles",
          new BigDecimal("55.00"),
          "AVAILABLE",
          List.of(new Ingredient("I-9", "Peanuts"), new Ingredient("I-4", "Wheat noodles")));
  static final DietaryRestriction ALLERGY =
      new DietaryRestriction("DR-2", "Peanut Allergy", "ALLERGY", "I-9");
  static final String SUBJECT = "Cannot cancel booking";
  static final String DESCRIPTION = "Cancel button is disabled";
  static final UserData DATA = new UserData("Emad Mohamed", "emad@student.edu", "Campus2026!");

  static Resource book(int copies) {
    return new Resource("L-300", "PRINTED_BOOK", "Clean Code", copies, true);
  }
}
