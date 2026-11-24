package edu.aiu.ssp;

import java.time.*;

public record SupportTicket(
    String id, String studentId, String subject, String description, String status) {}
