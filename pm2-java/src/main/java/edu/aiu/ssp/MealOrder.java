package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;
import java.util.List;

public record MealOrder(
    String id,
    String studentId,
    String mealId,
    BigDecimal amount,
    List<DietaryRestriction> conflicts,
    String status) {
  MealOrder after(String event) {
    return new MealOrder(
        id, studentId, mealId, amount, conflicts, Lifecycle.MealOrder.next(status, event));
  }
}
