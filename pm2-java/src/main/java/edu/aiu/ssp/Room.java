package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;

public record Room(
    String id, String number, int capacity, int spaces, BigDecimal price, String status) {}
