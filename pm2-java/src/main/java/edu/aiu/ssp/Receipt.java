package edu.aiu.ssp;

import java.time.*;

public record Receipt(String id, String paymentId, String number, LocalDate issuedAt) {}
