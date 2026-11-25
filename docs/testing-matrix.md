# Testing code and test-case mapping

Every test case ID from the accepted Test Report is present in a test method name. JavaScript service tests keep the report ID exactly (`TC1.1`); Java method names replace the dot with an underscore because Java identifiers cannot contain `.` (`TC1_1_...`).

## Test folders

- [JUnit/Mockito/unit test folder](../pm2-java/src/test/java/edu/aiu/ssp)
- [Object-diagram fixtures](../pm2-java/src/test/java/edu/aiu/ssp/Fixtures.java)
- [State transitions, valid and invalid](../pm2-java/src/test/resources/transitions.csv)
- [Service test folders](../services)

## Mapping

| Test case | Service test method | JUnit / Mockito method |
|---|---|---|
| TC1.1 | [TC1.1 TC1.2 TC1.3 registers, logs in and rejects duplicate email](../services/user-service/test/app.test.js) | [TC1_1_registersStudentAndSendsWelcome](../pm2-java/src/test/java/edu/aiu/ssp/AuthenticationManagerTest.java) |
| TC1.2 | [TC1.1 TC1.2 TC1.3 registers, logs in and rejects duplicate email](../services/user-service/test/app.test.js) | [TC1_2_duplicateEmailStopsRegistration](../pm2-java/src/test/java/edu/aiu/ssp/AuthenticationManagerTest.java) |
| TC1.3 | [TC1.1 TC1.2 TC1.3 registers, logs in and rejects duplicate email](../services/user-service/test/app.test.js) | n/a |
| TC1.4 | [TC1.4 TC1.10 rejects bad credentials and suspended accounts](../services/user-service/test/app.test.js) | [TC1_4_loginGuardDistinguishesSuspendedAndDeactivated](../pm2-java/src/test/java/edu/aiu/ssp/AuthenticationManagerTest.java) |
| TC1.5 | [TC1.5 TC1.6 TC1.7 updates profile and recovers password](../services/user-service/test/app.test.js) | n/a |
| TC1.6 | [TC1.5 TC1.6 TC1.7 updates profile and recovers password](../services/user-service/test/app.test.js) | n/a |
| TC1.7 | [TC1.5 TC1.6 TC1.7 updates profile and recovers password](../services/user-service/test/app.test.js) | n/a |
| TC1.8 | [TC1.8 aggregates activity from peer services](../services/user-service/test/app.test.js) | n/a |
| TC1.9 | [TC1.9 admin assigns roles and creates staff accounts](../services/user-service/test/app.test.js) | n/a |
| TC1.10 | [TC1.4 TC1.10 rejects bad credentials and suspended accounts](../services/user-service/test/app.test.js) | [TC1_10_managesEveryUserStatusTransition](../pm2-java/src/test/java/edu/aiu/ssp/AuthenticationManagerTest.java) |
| TC2.1 | [TC2.1 TC2.2 browses and filters accommodation catalogue](../services/accommodation-service/test/app.test.js) | [TC2_1_readsAvailableRoomAndPersistsBookedStatus](../pm2-java/src/test/java/edu/aiu/ssp/InventoryManagerTest.java) |
| TC2.2 | [TC2.1 TC2.2 browses and filters accommodation catalogue](../services/accommodation-service/test/app.test.js) | n/a |
| TC2.3 | [TC2.3 TC2.4 TC2.5 books, rejects overlaps, lists and cancels a room](../services/accommodation-service/test/app.test.js) | [TC2_3_confirmsPaidBookingInDiagramOrder](../pm2-java/src/test/java/edu/aiu/ssp/BookingManagerTest.java) |
| TC2.4 | [TC2.3 TC2.4 TC2.5 books, rejects overlaps, lists and cancels a room](../services/accommodation-service/test/app.test.js) | [TC2_4_unavailableInventoryRejectsBooking](../pm2-java/src/test/java/edu/aiu/ssp/BookingManagerTest.java)<br>[TC2_4_unavailableInventoryRejectsBooking](../pm2-java/src/test/java/edu/aiu/ssp/TransportBookingManagerTest.java) |
| TC2.5 | [TC2.3 TC2.4 TC2.5 books, rejects overlaps, lists and cancels a room](../services/accommodation-service/test/app.test.js) | [TC2_5_cancelsConfirmedAndPendingBookings](../pm2-java/src/test/java/edu/aiu/ssp/BookingManagerTest.java) |
| TC2.6 | [TC2.6 TC2.7 admin manages buildings and room availability while students are denied](../services/accommodation-service/test/app.test.js) | [TC2_6_TC2_7_createsAndTransitionsRoomsThroughDiagram](../pm2-java/src/test/java/edu/aiu/ssp/InventoryManagerTest.java) |
| TC2.7 | [TC2.6 TC2.7 admin manages buildings and room availability while students are denied](../services/accommodation-service/test/app.test.js) | [TC2_6_TC2_7_createsAndTransitionsRoomsThroughDiagram](../pm2-java/src/test/java/edu/aiu/ssp/InventoryManagerTest.java) |
| TC2.8 | [TC2.8 TC2.9 TC2.10 requires a completed stay before accepting a review](../services/accommodation-service/test/app.test.js) | n/a |
| TC2.9 | [TC2.8 TC2.9 TC2.10 requires a completed stay before accepting a review](../services/accommodation-service/test/app.test.js) | n/a |
| TC2.10 | [TC2.8 TC2.9 TC2.10 requires a completed stay before accepting a review](../services/accommodation-service/test/app.test.js) | n/a |
| TC3.1 | [TC3.1 TC3.2 browses routes and schedules](../services/transport-service/test/app.test.js) | n/a |
| TC3.2 | [TC3.1 TC3.2 browses routes and schedules](../services/transport-service/test/app.test.js) | n/a |
| TC3.3 | [TC3.3 TC3.5 books a seat, prevents duplicates and cancels with a refund](../services/transport-service/test/app.test.js) | [TC3_3_persistsElevenRemainingSeats](../pm2-java/src/test/java/edu/aiu/ssp/RouteManagerTest.java)<br>[TC3_3_confirmsPaidBookingInDiagramOrder](../pm2-java/src/test/java/edu/aiu/ssp/TransportBookingManagerTest.java) |
| TC3.4 | [TC3.4 enforces schedule capacity](../services/transport-service/test/app.test.js) | [TC3_4_preventsNegativeCapacity](../pm2-java/src/test/java/edu/aiu/ssp/RouteManagerTest.java) |
| TC3.5 | [TC3.3 TC3.5 books a seat, prevents duplicates and cancels with a refund](../services/transport-service/test/app.test.js) | [TC3_5_cancelReleasesSeatAndNotifies](../pm2-java/src/test/java/edu/aiu/ssp/TransportBookingManagerTest.java) |
| TC3.6 | [TC3.6 TC3.7 admin manages routes and schedules while students are denied](../services/transport-service/test/app.test.js) | n/a |
| TC3.7 | [TC3.6 TC3.7 admin manages routes and schedules while students are denied](../services/transport-service/test/app.test.js) | n/a |
| TC4.1 | [TC4.1 TC4.2 browses and filters approved clubs](../services/club-service/test/app.test.js) | [TC4_1_readsRoboticsClub](../pm2-java/src/test/java/edu/aiu/ssp/ClubBrowserTest.java) |
| TC4.2 | [TC4.1 TC4.2 browses and filters approved clubs](../services/club-service/test/app.test.js) | n/a |
| TC4.3 | [TC4.3 TC4.4 TC4.6 TC4.9 proposes, approves, joins and leaves a club](../services/club-service/test/app.test.js) | [TC4_3_joinsApprovedRoboticsClub](../pm2-java/src/test/java/edu/aiu/ssp/MembershipManagerTest.java) |
| TC4.4 | [TC4.3 TC4.4 TC4.6 TC4.9 proposes, approves, joins and leaves a club](../services/club-service/test/app.test.js) | [TC4_4_activeMemberCannotJoinTwice](../pm2-java/src/test/java/edu/aiu/ssp/MembershipManagerTest.java) |
| TC4.5 | [TC4.5 TC4.10 admin rejects and suspends clubs](../services/club-service/test/app.test.js) | [TC4_5_pendingAndSuspendedClubsRejectMembership](../pm2-java/src/test/java/edu/aiu/ssp/MembershipManagerTest.java) |
| TC4.6 | [TC4.3 TC4.4 TC4.6 TC4.9 proposes, approves, joins and leaves a club](../services/club-service/test/app.test.js) | [TC4_6_leavesAndRejoinsClub](../pm2-java/src/test/java/edu/aiu/ssp/MembershipManagerTest.java) |
| TC4.7 | [TC4.7 TC4.8 manages club events and restricts membership lists](../services/club-service/test/app.test.js) | n/a |
| TC4.8 | [TC4.7 TC4.8 manages club events and restricts membership lists](../services/club-service/test/app.test.js) | n/a |
| TC4.9 | [TC4.3 TC4.4 TC4.6 TC4.9 proposes, approves, joins and leaves a club](../services/club-service/test/app.test.js) | [TC4_9_adminApprovesPhotographyClub](../pm2-java/src/test/java/edu/aiu/ssp/ClubApprovalManagerTest.java) |
| TC4.10 | [TC4.5 TC4.10 admin rejects and suspends clubs](../services/club-service/test/app.test.js) | [TC4_10_adminSuspendsApprovedClubAndReinstatesSuspendedClub](../pm2-java/src/test/java/edu/aiu/ssp/ClubApprovalManagerTest.java) |
| TC5.1 | [TC5.1 TC5.2 browses menus and meal details](../services/dining-service/test/app.test.js) | n/a |
| TC5.2 | [TC5.1 TC5.2 browses menus and meal details](../services/dining-service/test/app.test.js) | [TC5_2_readsGrilledChickenStock](../pm2-java/src/test/java/edu/aiu/ssp/KitchenInventoryManagerTest.java) |
| TC5.3 | [TC5.3 TC5.4 TC5.5 TC5.6 orders a meal and cancels before the deadline](../services/dining-service/test/app.test.js) | [TC5_3_ordersGrilledChickenAndPays](../pm2-java/src/test/java/edu/aiu/ssp/MealOrderManagerTest.java) |
| TC5.4 | [TC5.3 TC5.4 TC5.5 TC5.6 orders a meal and cancels before the deadline](../services/dining-service/test/app.test.js) | [TC5_4_unavailableMealStopsOrder](../pm2-java/src/test/java/edu/aiu/ssp/MealOrderManagerTest.java) |
| TC5.5 | [TC5.3 TC5.4 TC5.5 TC5.6 orders a meal and cancels before the deadline](../services/dining-service/test/app.test.js) | [TC5_5_cancelsPaidOrderBeforeDeadline](../pm2-java/src/test/java/edu/aiu/ssp/MealOrderManagerTest.java) |
| TC5.6 | [TC5.3 TC5.4 TC5.5 TC5.6 orders a meal and cancels before the deadline](../services/dining-service/test/app.test.js) | [TC5_6_rejectsLateCancellationBeforeAnyPersistence](../pm2-java/src/test/java/edu/aiu/ssp/MealOrderManagerTest.java) |
| TC5.7 | [TC5.7 TC5.8 admin manages meals and stock while students are denied](../services/dining-service/test/app.test.js) | [TC5_7_createsMealAsAvailable](../pm2-java/src/test/java/edu/aiu/ssp/KitchenInventoryManagerTest.java) |
| TC5.8 | [TC5.7 TC5.8 admin manages meals and stock while students are denied](../services/dining-service/test/app.test.js) | [TC5_8_appliesMealStockTransitions](../pm2-java/src/test/java/edu/aiu/ssp/KitchenInventoryManagerTest.java) |
| TC5.9 | [TC5.9 TC5.10 saves dietary preferences and highlights conflicts](../services/dining-service/test/app.test.js) | n/a |
| TC5.10 | [TC5.9 TC5.10 saves dietary preferences and highlights conflicts](../services/dining-service/test/app.test.js) | [TC5_10_peanutIngredientConflictsWithSavedAllergy](../pm2-java/src/test/java/edu/aiu/ssp/DietaryPreferenceManagerTest.java)<br>[TC5_10_paidOrderHighlightsConflicts](../pm2-java/src/test/java/edu/aiu/ssp/MealOrderManagerTest.java) |
| TC6.1 | [TC6.1 TC6.2 delivers, lists and marks notifications as read](../services/communication-service/test/app.test.js) | [TC6_1_deliversTicketEmail](../pm2-java/src/test/java/edu/aiu/ssp/NotificationManagerTest.java) |
| TC6.2 | [TC6.1 TC6.2 delivers, lists and marks notifications as read](../services/communication-service/test/app.test.js) | [TC6_2_marksSentNotificationAsRead](../pm2-java/src/test/java/edu/aiu/ssp/NotificationManagerTest.java) |
| TC6.3 | [TC6.3 TC6.4 submits, responds to and resolves support tickets](../services/communication-service/test/app.test.js) | [TC6_3_opensTicketAndRequestsNotification](../pm2-java/src/test/java/edu/aiu/ssp/SupportTicketManagerTest.java) |
| TC6.4 | [TC6.3 TC6.4 submits, responds to and resolves support tickets](../services/communication-service/test/app.test.js) | [TC6_4_repliesAndResolvesTicketThroughDiagram](../pm2-java/src/test/java/edu/aiu/ssp/SupportTicketManagerTest.java) |
| TC6.5 | [TC6.5 TC6.6 builds analytics summaries and CSV club reports](../services/communication-service/test/app.test.js) | n/a |
| TC6.6 | [TC6.5 TC6.6 builds analytics summaries and CSV club reports](../services/communication-service/test/app.test.js) | n/a |
| TC6.7 | [TC6.7 TC6.8 TC6.9 manages semester settings and announcements](../services/communication-service/test/app.test.js) | n/a |
| TC6.8 | [TC6.7 TC6.8 TC6.9 manages semester settings and announcements](../services/communication-service/test/app.test.js) | n/a |
| TC6.9 | [TC6.7 TC6.8 TC6.9 manages semester settings and announcements](../services/communication-service/test/app.test.js) | n/a |
| TC7.1 | [TC7.1 searches and filters the library catalogue](../services/library-service/test/app.test.js) | [TC7_1_readsCleanCodeFromCatalog](../pm2-java/src/test/java/edu/aiu/ssp/CatalogManagerTest.java) |
| TC7.2 | [TC7.2 reserves, collects, cancels and returns printed resources](../services/library-service/test/app.test.js) | [TC7_2_reservesCleanCodeAndReturnsRemainingCopy](../pm2-java/src/test/java/edu/aiu/ssp/ResourceSearchAccessTest.java) |
| TC7.3 | [TC7.3 logs digital downloads](../services/library-service/test/app.test.js) | [TC7_3_digitalDownload](../pm2-java/src/test/java/edu/aiu/ssp/ResourceSearchAccessTest.java) |
| TC7.4 | [TC7.4 admin manages the catalogue while students are denied](../services/library-service/test/app.test.js) | n/a |
| TC8.1 | [TC8.1 TC8.2 pays fees and issues receipts](../services/payment-service/test/app.test.js) | [TC8_1_paysHousingFeeAndIssuesReceipt](../pm2-java/src/test/java/edu/aiu/ssp/FeePaymentProcessorTest.java)<br>[TC8_1_chargesExternalGateway](../pm2-java/src/test/java/edu/aiu/ssp/GatewayAdapterTest.java) |
| TC8.2 | [TC8.1 TC8.2 pays fees and issues receipts](../services/payment-service/test/app.test.js) | [TC8_2_declineNotifiesWithoutReceipt](../pm2-java/src/test/java/edu/aiu/ssp/FeePaymentProcessorTest.java)<br>[TC8_2_declinedChargeCallsGateway](../pm2-java/src/test/java/edu/aiu/ssp/GatewayAdapterTest.java) |
| TC8.3 | [TC8.3 TC8.4 requests, approves, rejects and issues refunds](../services/payment-service/test/app.test.js) | [TC8_3_studentRequestsRefund](../pm2-java/src/test/java/edu/aiu/ssp/RefundManagerTest.java) |
| TC8.4 | [TC8.3 TC8.4 requests, approves, rejects and issues refunds](../services/payment-service/test/app.test.js) | [TC8_4_refundCallsGatewayAndHandlesFailure](../pm2-java/src/test/java/edu/aiu/ssp/GatewayAdapterTest.java)<br>[TC8_4_approvedRefundIsIssuedThroughGateway](../pm2-java/src/test/java/edu/aiu/ssp/RefundManagerTest.java) |

Additional unit tests for invalid states, authorization guards, gateway failures, and object-diagram message order remain in the same folders and are prefixed with `PM2_` where they are supporting checks rather than acceptance cases.

