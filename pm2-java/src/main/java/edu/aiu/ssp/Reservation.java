package edu.aiu.ssp;

import java.time.*;

public record Reservation(String id, String studentId, String resourceId, String status) {}
