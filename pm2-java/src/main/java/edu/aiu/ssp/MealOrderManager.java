package edu.aiu.ssp;

import java.time.*;
import java.util.List;

public record MealOrderManager(
    IAccount account,
    KitchenInventoryManager inventory,
    DietaryPreferenceManager dietary,
    IDiningDB db,
    IPayment payment,
    ICommunication comm,
    Identifiers ids) {
  public MealOrder orderMeal(String studentId, String mealId) {
    if (!account.verifyStudent(studentId)) throw new UnauthorizedStudentException();
    Meal meal = inventory.getStockStatus(mealId);
    if (meal == null || !"AVAILABLE".equals(meal.stockStatus()))
      throw new MealUnavailableException();
    List<DietaryRestriction> conflicts = dietary.highlightConflicts(studentId, mealId);
    MealOrder order =
        new MealOrder(
            ids.next("order"),
            studentId,
            mealId,
            meal.price(),
            conflicts,
            Lifecycle.MealOrder.next("INITIAL", "order"));
    db.saveOrder(order);
    boolean paid = payment.payFees(studentId, "MEAL", order.id(), order.amount());
    MealOrder result = order.after(paid ? "paid" : "declined");
    db.updateOrderStatus(result.id(), result.status());
    if (paid) comm.sendNotification(studentId, "Order " + result.id() + " paid");
    return result;
  }

  /** PAID -> CANCELLED before the cancellation deadline (FR16.2). */
  public MealOrder cancelOrder(String orderId, boolean beforeDeadline) {
    if (!beforeDeadline) throw new CancellationDeadlinePassed();
    MealOrder current = db.findOrder(orderId);
    if (current == null) throw new ValidationException();
    MealOrder result = current.after("cancelBeforeDeadline");
    db.updateOrderStatus(result.id(), result.status());
    comm.sendNotification(current.studentId(), "Order " + result.id() + " cancelled");
    return result;
  }

  /** PAID -> COMPLETED when the meal is served. */
  public MealOrder serveOrder(String orderId) {
    MealOrder current = db.findOrder(orderId);
    if (current == null) throw new ValidationException();
    MealOrder result = current.after("serve");
    db.updateOrderStatus(result.id(), result.status());
    comm.sendNotification(current.studentId(), "Order " + result.id() + " served");
    return result;
  }
}
