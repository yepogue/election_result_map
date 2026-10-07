import data from "../../public/data/renter_analysis.json";
import sources from "../../public/data/sources.json";
import census from "../../public/data/census_data_dictionary.json";
import RenterAnalysis from "./RenterAnalysis";
import challengers from "../../public/data/challenger_renter_analysis.json";

export default function RentersVotingPage() {
  return <RenterAnalysis data={data} sources={sources} census={census} challengers={challengers} />;
}
