import { Calendar, Event } from "@musubi/types";
import { colors, fonts, styles } from "@/constants/theme";
import { useEffect, useState } from "react";
import { Alert, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { appColors } from "@/constants/colors";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useServer } from "@/contexts/ServerContext";
import { EVENT_HINTS } from "@/constants/event_hints";

type Props = {
  visible: boolean;
  startingDate?: Date;
  onClose: () => void;
  onSave: (event: Event) => Promise<void>;
  onEdit: (event: Event) => Promise<void>;
  calendars: Calendar[];
  event?: Event;
};

export function AddEventModal({ visible, startingDate, onClose, onSave, onEdit, calendars, event }: Props) {
  const insets = useSafeAreaInsets();
  const { authClient } = useServer();
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newStart, setNewStart] = useState(startingDate ?? new Date());
  const [newEnd, setNewEnd] = useState(startingDate ?? new Date());
  const [allDayToggle, setAllDayToggle] = useState(false);
  // const [showStartPicker, setShowStartPicker] = useState(false);
  // const [showEndPicker, setShowEndPicker] = useState(false);
  const [selectedCals, setSelectedCals] = useState<Set<string>>(
    () => new Set(calendars.slice(0, 1).map(c => c.id))
  );
  const [newColor, setNewColor] = useState(appColors[0].color);
  const [isLoading, setIsLoading] = useState(false);
  const [eventHint, setEventHint] = useState(EVENT_HINTS[Math.floor(Math.random() * EVENT_HINTS.length)])

  const [nameError, setNameError] = useState("");
  const [calendarsError, setCalendarsError] = useState("");
  const [startError, setStartError] = useState("");
  const [endError, setEndError] = useState("");

  const { data: session } = authClient.useSession();
  const userID = session?.user.id;

  const closeSequence = () => {
    onClose();

    setNewTitle('');
    setNameError("");
    setNewStart(new Date());
    setStartError("");
    setNewEnd(new Date());
    setEndError("");
    setSelectedCals(new Set(calendars.slice(0, 1).map(c => c.id)));
    setCalendarsError("");
    setEventHint(EVENT_HINTS[Math.floor(Math.random() * EVENT_HINTS.length)]);
  }

  const { slideStyle, fadeStyle, gesture, handleClose } = useModalAnimation(visible, closeSequence);

  useEffect(() => {
    if (visible) {
      setNewTitle(event?.title ?? "");
      setNewStart(event?.start ?? startingDate ?? new Date());
      setNewEnd(event?.end ?? startingDate ?? new Date());
      setSelectedCals(new Set(event?.calendars) ?? new Set<string>);
    }
  }, [event, visible]);

  useEffect(() => {
    if (newStart.getTime() > newEnd.getTime()) {
      setNewEnd(newStart);
    }
  }, [newStart]);

  const toggleCal = (id: string) => {
    setSelectedCals(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const showDatePicker = (mode: 'start' | 'end') => {
    const current = mode === 'start' ? newStart : newEnd;
    const setter = mode === 'start' ? setNewStart : setNewEnd;

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode: 'date',
        onChange: (e, date) => {
          if (e.type === 'set' && date) {
            setter(date);
          }
        },
      });
    }
  };

  const showTimePicker = (mode: 'start' | 'end') => {
    const current = mode === 'start' ? newStart : newEnd;
    const setter = mode === 'start' ? setNewStart : setNewEnd;

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: roundMinutes(current),
        mode: 'time',
        onChange: (e, timeDate) => {
          if (e.type === 'set' && timeDate) {
            setter(timeDate);
          }
        },
      });
    }
  };

  function roundMinutes(date: Date) {

    date.setHours(date.getHours() + Math.round(date.getMinutes() / 60));
    date.setMinutes(0, 0, 0);

    return date;
  }


  const handleSave = async () => {

    const eventConstruct: Event = {
      id: event?.id ?? "create",
      creatorID: userID!,
      organizer: userID!, //TODO: ADD Organizer selection option in client
      calendars: [...selectedCals],
      title: newTitle,
      color: newColor,
      start: allDayToggle ? new Date(newStart.setHours(0, 0, 0, 0)) : newStart,
      end: allDayToggle ? new Date(newEnd.setHours(0, 0, 0, 0)) : newEnd,
      isAllDay: allDayToggle,
      isCanceled: false, //TODO: Before cal sync we need a system for event status
      description: newDescription,
      location: "", //TODO: ADD location field to events
      recurrence: "", //TODO: Recurring events function needs to be added... (Fear that I'll have to fork the bigcalendar lib and change it to fit my needs...)
      url: "", //TODO: ADD url link field to events
    }

    let passed: boolean = true;

    if (newTitle.length === 0) {
      setNameError("I mean... At least one letter please...");
      passed = false;
    } else {
      setNameError("");
    }
    if ([...selectedCals].length === 0) {
      setCalendarsError("Event needs some cozy place... Give it atleast one...");
      passed = false;
    } else {
      setCalendarsError("");
    }
    if (newStart.getTime() > newEnd.getTime()) {
      setStartError("I don't think so...");
      setEndError("I should probably be the one in front...");
      passed = false;
    } else {
      setStartError("");
      setEndError("");
    }

    if (!passed) {
      return;
    }

    setIsLoading(true);

    try {
      if (event) {
        onEdit(eventConstruct);
      } else {
        onSave(eventConstruct);
      }
    } catch (e: any) {
      setIsLoading(false);
      Alert.alert("Failed to save", e?.message ?? "An unexpected error occured.");
    }
    setIsLoading(false);
    handleClose();
  };

  return (
    <>
      <Modal
        visible={visible}
        onRequestClose={handleClose}
        animationType="none"
        transparent={true}
        statusBarTranslucent={true}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Animated.View style={[styles.modalOverlay, fadeStyle]}>
            <Pressable style={{ flex: 1 }} onPress={handleClose} />
          </Animated.View>
          <Animated.View style={[styles.modalSheet, fadeStyle, slideStyle]}>
            <GestureDetector gesture={gesture}>
              <View>
                <View style={styles.modalHandle} />

                <View style={styles.modalTitleRow}>
                  <Text style={styles.modalTitle}>{event ? "Edit Event" : "New Event"}</Text>
                </View>

              </View>
            </GestureDetector>
            <ScrollView>
              <View style={styles.fieldContainer}>
                <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Title</Text>
                <TextInput
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder={eventHint}
                  placeholderTextColor={colors.fg4}
                  multiline={true}
                  style={[styles.fieldValueBig, { fontFamily: fonts.sans }]}
                />
                {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
              </View>

              <View style={styles.fieldContainer}>
                <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Calendars</Text>
                <ScrollView
                  horizontal
                >
                  <View style={styles.horizontalPillView}>
                    {calendars.map((cal) => {
                      const active = selectedCals.has(cal.id);
                      return (
                        <Pressable
                          key={cal.id}
                          onPress={() => toggleCal(cal.id)}
                          style={active ? styles.pillActive : styles.pill}
                        >
                          <View style={[styles.colorDot, { backgroundColor: cal.color, opacity: active ? 1 : 0.4 }]} />
                          <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: active ? colors.fg : colors.fg3 }}>
                            {cal.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
                {calendarsError ? <Text style={styles.errorText}>{calendarsError}</Text> : null}
              </View>

              <View style={styles.fieldContainer}>
                <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Colors</Text>
                <ScrollView
                  horizontal
                >
                  <View style={styles.horizontalPillView}>
                    {appColors.map((c) => (
                      <Pressable
                        key={c.name}
                        style={{
                          overflow: "hidden",
                          flexDirection: "row",
                          justifyContent: "space-between",
                          gap: 18,
                        }}
                        onPress={() => setNewColor(c.color)}
                      >
                        <View style={[styles.calendarCircle, {
                          borderWidth: c.color === newColor ? 2 : 1,
                          borderColor: c.color === newColor ? colors.fg3 : colors.line3,
                        }]}>
                          <View style={[styles.calendarCircleInner, { backgroundColor: c.color }]} />
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <View style={styles.fieldContainer}>
                <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 8 }}>
                  <Text style={[styles.fieldLabel, { fontFamily: fonts.sans, alignSelf: "center" }]}>All Day</Text>
                  <Switch
                    style={{ alignSelf: "center" }}
                    thumbColor={allDayToggle ? colors.accent : colors.bg3}
                    trackColor={{
                      false: colors.line,
                      true: colors.line3,
                    }}
                    onValueChange={(v) => { setAllDayToggle(v) }}
                    value={allDayToggle}
                  />
                </View>
                {startError ? <Text style={styles.errorText}>{startError}</Text> : null}
              </View>

              <View style={styles.fieldContainer}>
                <View style={{ flexDirection: "row", gap: 32 }}>
                  <Pressable onPress={() => showDatePicker("start")}>
                    <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Start Date</Text>
                    <Text style={[styles.fieldValueText, { fontFamily: fonts.sans }]}>
                      {newStart.toLocaleString('en-UK', { dateStyle: 'medium' })}
                    </Text>
                  </Pressable>
                  {!allDayToggle &&
                    <Pressable onPress={() => showTimePicker("start")}>
                      <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Time</Text>
                      <Text style={[styles.fieldValueText, { fontFamily: fonts.sans }]}>
                        {newStart.toLocaleString('en-UK', { timeStyle: 'short' })}
                      </Text>
                    </Pressable>
                  }
                </View>
                {startError ? <Text style={styles.errorText}>{startError}</Text> : null}
              </View>

              {/* {Platform.OS === 'ios' && showStartPicker && ( */}
              {/*   <DateTimePicker value={newStart} mode="datetime" */}
              {/*     onChange={(e, date) => { setShowStartPicker(false); if (e.type === 'set' && date) setNewStart(date); }} */}
              {/*   /> */}
              {/* )} */}

              <View style={styles.fieldContainer}>
                <View style={{ flexDirection: "row", gap: 32 }}>
                  <Pressable onPress={() => showDatePicker("end")}>
                    <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>End Date</Text>
                    <Text style={[styles.fieldValueText, { fontFamily: fonts.sans }]}>
                      {newEnd.toLocaleString('en-UK', { dateStyle: 'medium' })}
                    </Text>
                  </Pressable>
                  {!allDayToggle &&
                    <Pressable onPress={() => showTimePicker("end")}>
                      <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Time</Text>
                      <Text style={[styles.fieldValueText, { fontFamily: fonts.sans }]}>
                        {newEnd.toLocaleString('en-UK', { timeStyle: 'short' })}
                      </Text>
                    </Pressable>
                  }
                </View>
                {endError ? <Text style={styles.errorText}>{endError}</Text> : null}
              </View>

              {/* {Platform.OS === 'ios' && showEndPicker && ( */}
              {/*   <DateTimePicker value={newEnd} mode="datetime" */}
              {/*     onChange={(e, date) => { setShowEndPicker(false); if (e.type === 'set' && date) setNewEnd(date); }} */}
              {/*   /> */}
              {/* )} */}

              <View style={styles.fieldContainer}>
                <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Note</Text>
                <TextInput
                  value={newDescription}
                  onChangeText={setNewDescription}
                  placeholder="..."
                  placeholderTextColor={colors.fg4}
                  multiline={true}
                  style={[styles.fieldValueBig, { fontFamily: fonts.sans }]}
                />
              </View>
            </ScrollView>
            <View style={[styles.modalButtons, { paddingBottom: insets.bottom + 16 }]}>
              <Pressable style={styles.btnSecondary} onPress={handleClose}>
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={isLoading ? [styles.btnPrimary, { backgroundColor: colors.line }] : styles.btnPrimary}
                onPress={handleSave}
                disabled={isLoading}
              >
                <Text style={styles.btnPrimaryText}>{event ? "Save" : "Create"}</Text>
              </Pressable>
            </View>
          </Animated.View>
        </GestureHandlerRootView>
      </Modal >
    </>
  );
}
