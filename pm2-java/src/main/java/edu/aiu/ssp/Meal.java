package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;
import java.util.List;

public record Meal(
    String id, String name, BigDecimal price, String stockStatus, List<Ingredient> ingredients) {}
