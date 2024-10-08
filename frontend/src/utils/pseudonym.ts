import { Principal } from "@dfinity/principal";

export function generateRandomPseudonym(pid: Principal): string {
  const prinBytes = pid.toUint8Array();
  const seed1 = prinBytes[3];
  const seed2 = prinBytes[4];

  return `${ADJECTIVES[seed1 % ADJECTIVES.length]} ${NOUNS[seed2 % NOUNS.length]}`;
}

const ADJECTIVES = [
  "Slight",
  "Rich",
  "Eventual",
  "Valid",
  "Judicial",
  "Thoughtful",
  "Developed",
  "Just",
  "Outdoor",
  "Empty",
  "Raw",
  "Deliberate",
  "Competent",
  "Terrible",
  "Asian",
  "Good",
  "Regional",
  "Rare",
  "Short",
  "Chronic",
  "Drunk",
  "Golden",
  "Particular",
  "Embarrassed",
  "Invisible",
  "Characteristic",
  "Sorry",
  "Crooked",
  "Healthy",
  "Fierce",
  "Real",
  "Dead",
  "Rapid",
  "Similar",
  "Excited",
  "Poor",
  "Puny",
  "Foolish",
  "Partial",
  "Junior",
  "Complicated",
  "Enchanting",
  "Wide",
  "Hollow",
  "Sore",
  "Misty",
  "Pretty",
  "Lesser",
  "Religious",
  "Genuine",
  "Very",
  "Mute",
  "Scientific",
  "Obnoxious",
  "Melted",
  "Electronic",
  "Passing",
  "Exclusive",
  "Victorian",
  "Gentle",
  "Kind",
  "Precise",
  "Bitter",
  "Frightened",
  "Impressive",
  "Excellent",
  "Unpleasant",
  "Regular",
  "Female",
  "Semantic",
  "Stable",
  "Evil",
  "Dull",
  "Melodic",
  "Happy",
  "Beautiful",
  "Managing",
  "Fresh",
  "Far",
  "Fortunate",
  "Liberal",
  "Angry",
  "Reliable",
  "Greek",
  "Horrible",
  "Handsome",
  "Scottish",
  "Decent",
  "Electrical",
  "Total",
  "Yellow",
  "Enthusiastic",
  "Loose",
  "Worthy",
  "Blue",
  "Dry",
  "Shallow",
  "Legitimate",
  "Calm",
  "Hot",
  "Civic",
  "Wrong",
  "Numerous",
  "Supporting",
  "Doubtful",
  "Sound",
  "Sour",
  "Wet",
  "Devoted",
  "Contemporary",
  "Deaf",
  "Ultimate",
  "Scared",
  "Reasonable",
  "Elderly",
  "Noisy",
  "Historical",
  "Nearby",
  "Shaggy",
  "Smart",
  "Immense",
  "Constant",
  "Past",
  "Specified",
  "German",
  "Upset",
  "Public",
  "Spicy",
  "Informal",
  "Brief",
  "Underground",
  "Busy",
  "Domestic",
  "Grim",
  "Excess",
  "Bottom",
  "Hungry",
  "Roasted",
  "Brave",
  "Crazy",
  "Minor",
  "Careful",
  "Prior",
  "Rough",
  "Mysterious",
  "Confused",
  "Long",
  "Current",
  "Lucky",
  "Vertical",
  "Bright",
  "Ministerial",
  "Fashionable",
  "Heavy",
  "Major",
  "Amateur",
  "Respective",
  "Teenage",
  "Involved",
  "Frail",
  "Nice",
  "Subjective",
  "Productive",
  "Jolly",
  "Nasty",
  "Intelligent",
  "Improved",
  "Dangerous",
  "Professional",
  "Accused",
  "Lovely",
  "Renewed",
  "Pleasant",
  "Various",
  "Arbitrary",
  "Incredible",
  "Cheerful",
  "Creepy",
  "Middle-class",
  "Mammoth",
  "Unknown",
  "Shaky",
  "Puzzled",
  "Plain",
  "Elegant",
  "Typical",
  "Unable",
  "Exact",
  "Filthy",
  "Keen",
  "Operational",
  "Voluntary",
  "Secure",
  "Selfish",
  "Ripe",
  "Worrying",
  "Thorough",
  "Mass",
  "Afraid",
  "Sheer",
  "Intact",
  "Required",
  "Acute",
  "Combative",
  "Quick",
  "Unusual",
  "Odd",
  "Proud",
  "Remaining",
  "Collective",
  "Blind",
  "Outstanding",
  "Clumsy",
  "Orange",
  "Neutral",
  "Fluffy",
  "Painful",
  "Crude",
  "Manual",
  "Comfortable",
  "Printed",
  "Dreadful",
  "Big",
  "Witty",
  "Protestant",
  "Chilly",
  "Narrow",
  "Early",
  "Safe",
  "Daily",
  "Popular",
  "Modern",
  "Prospective",
  "Blushing",
  "Gradual",
  "Tender",
  "Convenient",
  "Intense",
  "Spontaneous",
  "Full-time",
  "Jealous",
  "Lengthy",
  "Upper",
  "Strategic",
  "Brown",
  "Gigantic",
  "Fast",
  "Furious",
  "Absent",
  "Absolute",
  "Abstract",
  "Canceled",
  "Academic",
  "Concrete",
  "Accepted",
  "Accessible",
];

const NOUNS = [
  "Randomisation",
  "Waist",
  "Nightingale",
  "Maiden",
  "Luttuce",
  "Cricketer",
  "Name",
  "Bike",
  "Bill",
  "Company",
  "Outset",
  "Bibliography",
  "Monday",
  "Sunlamp",
  "Director",
  "Ghana",
  "Jewelry",
  "Break",
  "Nudge",
  "Buckle",
  "Stick",
  "Dream",
  "Astrolabe",
  "Burma",
  "Ship",
  "Throne",
  "Baobab",
  "Shaker",
  "Laparoscope",
  "Celery",
  "Slope",
  "Drink",
  "Bower",
  "Seed",
  "Billboard",
  "Chit-chat",
  "Bomb",
  "Lumber",
  "Fixture",
  "Brushfire",
  "Ranch",
  "Rail",
  "Schedule",
  "Cucumber",
  "Handmaiden",
  "Archaeology",
  "Crib",
  "Counter",
  "Steamroller",
  "Glove",
  "Gladiolus",
  "Mood",
  "Cracker",
  "Belligerency",
  "Bit",
  "Granny",
  "Impudence",
  "Microwave",
  "Galley",
  "Others",
  "Hobbit",
  "Buffet",
  "Umbrella",
  "Yacht",
  "Shelf",
  "Balloon",
  "Floozie",
  "Archeology",
  "Hostess",
  "Drunk",
  "Gaffer",
  "Square",
  "Elephant",
  "Bag",
  "Vibraphone",
  "Suburb",
  "Celsius",
  "Armoire",
  "Radish",
  "Reflection",
  "Orangutan",
  "Input",
  "Scent",
  "Crest",
  "Migrant",
  "Inn",
  "Driver",
  "Bin",
  "Cost",
  "Purse",
  "Appendix",
  "Bass",
  "Phrase",
  "Rowboat",
  "Climb",
  "Vessel",
  "Cowbell",
  "Grey",
  "Canteen",
  "Crown",
  "Drake",
  "Bacon",
  "Temper",
  "Thursday",
  "Spectacles",
  "Leo",
  "Scorn",
  "Accelerator",
  "Chord",
  "Filth",
  "Discovery",
  "Millisecond",
  "Cardigan",
  "Outside",
  "Heron",
  "Scissors",
  "Tabernacle",
  "Spectrograph",
  "Saving",
  "Ketchup",
  "Inglenook",
  "Paleontologist",
  "Procedure",
  "Icecream",
  "Skiing",
  "Prose",
  "Tavern",
  "Brandy",
  "Tailspin",
  "Capitulation",
  "Brush",
  "Hamster",
  "Jacket",
  "Dragonfly",
  "Steam",
  "Windage",
  "East",
  "Adapter",
  "Safety",
  "Sell",
  "Waste",
  "Knife",
  "Chick",
  "Hydrogen",
  "Runaway",
  "Duststorm",
  "Harbour",
  "Tunic",
  "Tempo",
  "Libra",
  "Sari",
  "Road",
  "Teacher",
  "Heater",
  "Senator",
  "Walker",
  "Zucchini",
  "Intelligence",
  "Lentil",
  "Mayor",
  "Train",
  "Dead",
  "Disconnection",
  "Hammock",
  "Tintype",
  "Depressive",
  "Hell",
  "Gold",
  "Inquiry",
  "Dipstick",
  "Analgesia",
  "Tsunami",
  "Blazer",
  "Mantua",
  "Stock-in-trade",
  "Safe",
  "Discount",
  "Flintlock",
  "Titanium",
  "Gender",
  "Writing",
  "Delivery",
  "Visit",
  "Hen",
  "Laundry",
  "Positive",
  "Wine",
  "Bugle",
  "Enquiry",
  "Counter-force",
  "Conference",
  "Birch",
  "Assistance",
  "Spine",
  "Daniel",
  "Boatyard",
  "Twister",
  "Turret",
  "Neurobiologist",
  "Nail",
  "Tepee",
  "Collar",
  "Planter",
  "Random",
  "Cheese",
  "Fruit",
  "Fifth",
  "January",
  "Sabre",
  "Push",
  "Chronometer",
  "Cactus",
  "Hydrant",
  "Scallion",
  "Snow",
  "Palm",
  "Permission",
  "Sing",
  "Gem",
  "Extent",
  "Nightgown",
  "Cement",
  "Employ",
  "Screw-up",
  "Macaroni",
  "Doubt",
  "Hypothermia",
  "Parsnip",
  "Antlantida",
  "Contract",
  "Manx",
  "Cowboy",
  "Corduroy",
  "Life",
  "Call",
  "Vast",
  "Cornerstone",
  "Self",
  "Issue",
  "Octagon",
  "Sweat",
  "Peacoat",
  "Jury",
  "Millimeter",
  "Slip",
  "September",
  "Ambassador",
  "Lead",
  "Saviour",
  "Violin",
  "Witch",
  "Alphabet",
  "Breakpoint",
  "Patient",
  "Calcification",
  "Atom",
];
