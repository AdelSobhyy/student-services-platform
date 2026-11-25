package edu.aiu.ssp;

import java.math.BigDecimal;
import java.time.*;
import java.util.List;

public record KitchenInventoryManager(IDiningDB db) {
  public Meal getStockStatus(String id) {
    return db.findMeal(id);
  }

  /** AVAILABLE -> OUT_OF_STOCK -> AVAILABLE, with AVAILABLE/restock idempotent. */
  public Meal setStockStatus(String id, String targetStatus) {
    Meal meal = db.findMeal(id);
    if (meal == null) throw new MealNotFoundException();
    String event =
        switch (targetStatus == null ? "" : targetStatus) {
          case "OUT_OF_STOCK" -> "soldOut";
          case "AVAILABLE" -> "restock";
          default -> throw new ValidationException();
        };
    String next = Lifecycle.Meal.next(meal.stockStatus(), event);
    db.updateMealStockStatus(id, next);
    return new Meal(meal.id(), meal.name(), meal.price(), next, meal.ingredients());
  }

  /** INITIAL -> AVAILABLE (manageMeals in the Meal state diagram). */
  public Meal createMeal(
      String id, String name, BigDecimal price, List<Ingredient> ingredients) {
    Meal meal =
        new Meal(id, name, price, Lifecycle.Meal.next("INITIAL", "create"), ingredients);
    db.saveMeal(meal);
    return meal;
  }

  /** OUT_OF_STOCK -> END. Dishes with active stock must be sold out first. */
  public Meal removeMeal(String id) {
    Meal meal = db.findMeal(id);
    if (meal == null) throw new MealNotFoundException();
    String next = Lifecycle.Meal.next(meal.stockStatus(), "remove");
    db.updateMealStockStatus(id, next);
    return new Meal(meal.id(), meal.name(), meal.price(), next, meal.ingredients());
  }
}
