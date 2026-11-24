package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;

public record RouteSchedule(
    String id,
    Route route,
    LocalDate date,
    LocalTime departure,
    LocalTime arrival,
    int seatsAvailable,
    int nextSeat,
    BigDecimal fare) {}
