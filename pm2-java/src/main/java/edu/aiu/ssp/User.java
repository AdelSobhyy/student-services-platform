package edu.aiu.ssp;

import java.time.*;

public record User(String id, String name, String email, String passwordHash, String status) {}
