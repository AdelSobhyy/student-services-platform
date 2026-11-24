package edu.aiu.ssp;

import java.time.*;
import java.util.List;

public interface IDiningDB {
  Meal findMeal(String id);

  List<DietaryRestriction> findDietaryPreferences(String studentId);

  void saveOrder(MealOrder order);

  void updateOrderStatus(String id, String status);
}
