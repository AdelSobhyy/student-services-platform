package edu.aiu.ssp;

import java.time.*;

public record Dates(LocalDate checkIn, LocalDate checkOut) {
  public Dates {
    if (checkIn == null || checkOut == null || !checkOut.isAfter(checkIn))
      throw new ValidationException();
  }
}
