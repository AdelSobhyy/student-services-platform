package edu.aiu.ssp;

import java.time.*;

public record Resource(String id, String type, String title, int copiesAvailable, boolean active) {}
