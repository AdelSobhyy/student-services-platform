package edu.aiu.ssp;

import java.time.*;
import java.util.List;

public record DietaryPreferenceManager(IDiningDB db) {
  public List<DietaryRestriction> highlightConflicts(String studentId, String mealId) {
    Meal meal = db.findMeal(mealId);
    if (meal == null) throw new MealNotFoundException();
    return matchIngredients(meal, db.findDietaryPreferences(studentId));
  }

  private List<DietaryRestriction> matchIngredients(
      Meal meal, List<DietaryRestriction> restrictions) {
    return restrictions.stream()
        .filter(r -> meal.ingredients().stream().anyMatch(i -> i.id().equals(r.ingredientId())))
        .toList();
  }
}
